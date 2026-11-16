// A plugin card's JSON view (moved out of PluginCard.tsx unchanged, but for the masking of a plugin
// whose schema isn't known): the whole config, `_meta` included, linted against the plugin's schema.
// Text that doesn't parse, or isn't an object, stays here and holds Save. Locked, it shows the stored
// value with its secrets masked behind "Show secrets"; what is never shown (a PEM private key in any
// value, a client_key) is masked locked and a note while editing (schema/keyNotes.ts), never the key. What the browser can't check of the schema (a
// pattern JavaScript can't compile, the keys and conditions that depend on one, or a schema Ajv
// can't compile) refuses nothing (schema/prepare.ts): a quiet note says what APISIX checks on save.
import { Eye, EyeOff } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { deepEqual } from '../editor/draft';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import { SchemaGapsNote } from '../schema-form/SchemaGapsNote';
import { mayHoldKeys, mayHoldNotes, newKeyNotes, unveilValue, veilTypedText, veilValue, type KeyNotes } from '../schema/keyNotes';
import { hideNeverShown, redactSecrets } from '../schema/secrets';
import { Button, CodeEditor, useLocked, usePending, useReveal } from '../ui';
import { inexactNumberIn } from '../ui/decimal';
import { maskConfig } from './secrets';

const pretty = (v: unknown): string => JSON.stringify(v, null, 2) ?? '';

interface JsonState {
  text: string;
  /** The config the text was last made from or turned into. */
  synced: unknown;
  /** Shown under the editor: why the text is not taken. */
  error: string | undefined;
  /** For Save (usePending): the text holds input that is not in the config. */
  held: string | undefined;
  /** The notes standing for private keys in the text (schema/keyNotes.ts). */
  notes: KeyNotes;
}

/** The text for `conf`, every value never shown as a note (fix round 1, R1), made with `notes`. */
function stateOf(conf: unknown, notes: KeyNotes): JsonState {
  const veiled = veilValue(conf, notes);
  return { text: pretty(veiled.value), synced: conf, error: undefined, held: undefined, notes: veiled.notes };
}

/** Whether `text` already says `value` (so the value coming back from a JSON edit keeps what was typed). */
function says(text: string, value: unknown, notes: KeyNotes): boolean {
  try {
    const back = unveilValue(JSON.parse(text), notes, { before: value });
    return back.ok && deepEqual(back.value, value);
  } catch {
    return false;
  }
}

/** The config as JSON (`_meta` included), linted against the plugin's schema. Locked, secrets are masked behind a reveal. */
export function ConfigJson({ name, conf, schema, encrypt, issues, onChange, onHeld }: {
  name: string;
  conf: unknown;
  schema: Obj | undefined;
  encrypt: string[];
  issues: Issue[];
  onChange: (conf: unknown) => void;
  onHeld: (held: boolean) => void;
}) {
  const locked = useLocked();
  /** `error` (shown) and `held` (for Save) are set while the text is not emitted. */
  const [state, setState] = useState(() => stateOf(conf, newKeyNotes()));
  const [revealed, setRevealed] = useReveal();
  // A config changed elsewhere replaces the text, unless the text holds Save: what was typed stays.
  let current = state;
  if (!Object.is(conf, state.synced)) {
    current = state.held !== undefined || says(state.text, conf, state.notes) ? { ...state, synced: conf } : stateOf(conf, state.notes);
    setState(current);
  }
  // A plugin whose schema isn't known (not loaded on this APISIX, or the list still loading) has every value
  // masked. A never-shown value (a client_key in the plugin's own upstream) stays masked when the rest is shown.
  const hidden = useMemo(() => {
    if (!locked) return undefined;
    const never = hideNeverShown(conf);
    const masked = schema ? redactSecrets(never.value, '', encrypt, schema) : maskConfig(never.value);
    return { value: masked.value, revealed: never.value, redacted: masked.redacted || never.hidden, revealable: masked.redacted };
  }, [locked, conf, encrypt, schema]);
  const holding = !locked && current.held !== undefined;
  usePending(holding ? current.held : undefined);
  useLayoutEffect(() => onHeld(holding), [onHeld, holding]);
  useLayoutEffect(() => () => onHeld(false), [onHeld]);

  /** `text` from the editor (`notes`: those it was written with, new ones on leaving). */
  function change(text: string, notes: KeyNotes = current.notes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const error = t('pl.card.jsonInvalid', { error: e instanceof Error ? e.message : String(e) });
      setState((s) => ({ ...s, text, notes, error, held: t('ui.pending.json', { field: name }) }));
      return;
    }
    if (!isObj(parsed)) {
      setState((s) => ({ ...s, text, notes, error: t('pl.card.notObject'), held: t('ui.pending.jsonType', { field: name, type: 'object' }) }));
      return;
    }
    // A number JSON.parse would round is not taken: what the text shows is what would be sent.
    const inexact = inexactNumberIn(text);
    if (inexact !== undefined) {
      setState((s) => ({ ...s, text, notes, error: t('json.inexact', { number: inexact }), held: t('ui.pending.inexact', { field: name, text: inexact }) }));
      return;
    }
    // Each note back to the key it stands for; a note that stands for none (or twice) holds the text.
    const back = mayHoldNotes(text) ? unveilValue(parsed, notes, { before: current.synced }) : ({ ok: true, value: parsed } as const);
    if (!back.ok) {
      const { problem } = back;
      setState((s) => ({ ...s, text, notes, error: problem, held: t('ui.pending.problem', { field: name, problem }) }));
      return;
    }
    setState((s) => ({ ...s, text, notes, synced: back.value, error: undefined, held: undefined }));
    onChange(back.value);
  }

  /**
   * Leaving the editor: a key typed or pasted here becomes a note: a whole key block in the raw text,
   * whether or not it parses or is held (the text then goes the usual way); else a key the config holds
   * with no note yet. Nothing else about the text changes.
   */
  function leave() {
    if (locked) return;
    const typed = veilTypedText(current.text, current.notes);
    if (typed.veiled) change(typed.text, typed.notes);
    else if (current.held === undefined && mayHoldKeys(current.text) && !veilValue(conf, current.notes, { mint: false }).complete) setState(stateOf(conf, current.notes));
  }

  // Locked: the stored value (never text typed before the lock), its secrets masked until revealed.
  const text = locked ? pretty(hidden?.redacted ? (revealed ? hidden.revealed : hidden.value) : conf) : current.text;
  return (
    <div className="pl-json">
      {locked && hidden?.revealable && (
        <div className="pl-json__bar">
          <Button size="sm" variant="ghost" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
            {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
          </Button>
        </div>
      )}
      <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && leave()}>
        <CodeEditor
          language="json"
          jsonSchema={schema}
          value={text}
          onChange={change}
          minLines={4}
          maxLines={24}
          aria-label={t('pl.card.jsonLabel', { name })}
          aria-invalid={!locked && current.held !== undefined}
        />
      </div>
      <div aria-live="polite">{!locked && current.error !== undefined && <p className="pl-json__error mono">{current.error}</p>}</div>
      {schema && <SchemaGapsNote schema={schema} className="pl-note" />}
      {issues.length > 0 && (
        <ul className="pl-json__issues">
          {issues.map((issue, i) => (
            <li key={i}>
              <code className="mono">{issue.path}</code> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
