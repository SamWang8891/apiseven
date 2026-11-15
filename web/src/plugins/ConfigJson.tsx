// A plugin card's JSON view (moved out of PluginCard.tsx unchanged, but for the masking of a plugin
// whose schema isn't known): the whole config, `_meta` included, linted against the plugin's schema.
// Text that doesn't parse, or isn't an object, stays here and holds Save. Locked, it shows the stored
// value with its secrets masked behind "Show secrets". What the browser can't check of the schema (a
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
import { redactSecrets } from '../schema/secrets';
import { Button, CodeEditor, useLocked, usePending, useReveal } from '../ui';
import { maskConfig } from './secrets';

const pretty = (v: unknown): string => JSON.stringify(v, null, 2) ?? '';

/** Whether `text` already says `value` (so the value coming back from a JSON edit keeps what was typed). */
function says(text: string, value: unknown): boolean {
  try {
    return deepEqual(JSON.parse(text), value);
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
  const [state, setState] = useState(() => ({ text: pretty(conf), synced: conf, error: undefined as string | undefined, held: undefined as string | undefined }));
  const [revealed, setRevealed] = useReveal();
  // A config changed elsewhere replaces the text, unless the text holds Save: what was typed stays.
  let current = state;
  if (!Object.is(conf, state.synced)) {
    current = state.held !== undefined || says(state.text, conf) ? { ...state, synced: conf } : { text: pretty(conf), synced: conf, error: undefined, held: undefined };
    setState(current);
  }
  // A plugin whose schema isn't known (not loaded on this APISIX, or the list still loading) has every value masked.
  const hidden = useMemo(() => (locked ? (schema ? redactSecrets(conf, '', encrypt, schema) : maskConfig(conf)) : undefined), [locked, conf, encrypt, schema]);
  const holding = !locked && current.held !== undefined;
  usePending(holding ? current.held : undefined);
  useLayoutEffect(() => onHeld(holding), [onHeld, holding]);
  useLayoutEffect(() => () => onHeld(false), [onHeld]);

  function change(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const error = t('pl.card.jsonInvalid', { error: e instanceof Error ? e.message : String(e) });
      setState((s) => ({ ...s, text, error, held: t('ui.pending.json', { field: name }) }));
      return;
    }
    if (!isObj(parsed)) {
      setState((s) => ({ ...s, text, error: t('pl.card.notObject'), held: t('ui.pending.jsonType', { field: name, type: 'object' }) }));
      return;
    }
    setState({ text, synced: parsed, error: undefined, held: undefined });
    onChange(parsed);
  }

  // Locked: the stored value (never text typed before the lock), its secrets masked until revealed.
  const text = locked ? pretty(hidden?.redacted && !revealed ? hidden.value : conf) : current.text;
  return (
    <div className="pl-json">
      {locked && hidden?.redacted && (
        <div className="pl-json__bar">
          <Button size="sm" variant="ghost" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
            {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
          </Button>
        </div>
      )}
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
