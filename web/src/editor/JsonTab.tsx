// The frame's JSON tab: the whole draft as text. It is every resource's full editor until a kind has
// form tabs, and stays the place where fields no form models are seen and changed.
import { Copy, Eye, EyeOff, WandSparkles } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAllPlugins } from '../api/hooks';
import { t } from '../i18n';
import { scopeOfKind, subsystemOf } from '../plugins/scope';
import type { Kind, Obj } from '../api/types';
import { copiedWithout, copiedWithoutKey, newKeyNotes, redactObject, unveilKeys, veilKeys, type KeyNotes } from '../plugins/secrets';
import { registry, type TabProps } from '../resources/registry';
import { Button, CodeEditor, toast, useEditingState, useLocked, usePending, useReveal } from '../ui';
import { inexactNumberIn } from '../ui/decimal';
import { mayHoldKeys, mayHoldNotes, veilTypedText } from '../schema/keyNotes';
import { deepEqual } from './draft';
import { parse, pretty } from './json';

const LINE = 18;
/** Room kept under the editor: its frame, and the page's bottom padding. */
const BELOW = 44;
/** While editing, the line under the editor where a parse error shows is kept free, so it appearing moves nothing. */
const ERROR_LINE = LINE;
const MIN_LINES = 12;

/** As many lines as fit between the editor's top and `below` px above the bottom of the window (at least MIN_LINES). */
function useFitLines(ref: RefObject<HTMLElement | null>, below: number): number {
  const [lines, setLines] = useState(30);
  useLayoutEffect(() => {
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setLines(Math.max(MIN_LINES, Math.floor((window.innerHeight - top - below) / LINE)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, below]);
  return lines;
}

interface JsonState {
  text: string;
  /** The draft the text was last made from or turned into. */
  synced: Obj;
  /** Shown under the editor: why the text is not taken. */
  error: string | undefined;
  /** For Save (usePending): the text holds input that is not in the draft. */
  held: string | undefined;
  /** The notes standing for private keys in the text (veilKeys), for this editing session. */
  notes: KeyNotes;
}

/** The text for `draft`, an SSL's private keys as notes (veilKeys), made with `notes`. */
function stateOf(kind: Kind, draft: Obj, notes: KeyNotes): JsonState {
  const veiled = veilKeys(kind, draft, notes);
  return { text: pretty(veiled.value), synced: draft, error: undefined, held: undefined, notes: veiled.notes };
}

/** `text` parsed, with each note turned back into its key; undefined when it doesn't parse or a note stands for no key. */
function draftOf(kind: Kind, text: string, notes: KeyNotes, before: Obj): Obj | undefined {
  const parsed = parse(text);
  if (!parsed.ok) return undefined;
  const back = unveilKeys(kind, parsed.value, notes, before);
  return back.ok ? back.value : undefined;
}

/**
 * A CodeMirror editor over JSON.stringify(draft). Every edit that parses to an object becomes the
 * draft; text that doesn't parse stays as typed, with the parser's message, and holds Save
 * (usePending: it counts as unsaved, and a tab switch asks first). When the draft changes from
 * elsewhere (a form tab, Discard) the text follows. Locked: read-only, still selectable and
 * copyable, its secrets masked (an auth plugin's key: redactObject) behind "Show secrets", which
 * hides them again on every lock change. While editing, the text is the real one: it is what Save
 * sends, except what is never shown (a PEM private key in any value, a client_key, an SSL's keys): a
 * note stands in each one's place and for it alone (veilKeys: a token made for this editing session,
 * not a position), wherever it is moved; removing a note removes its key, and a note that stands for
 * no key, is used twice or is left damaged holds Save. A key typed or pasted here shows as typed until
 * the editor is left, and is a note from then on. The text and its notes are editing state: they start
 * over when the editing session ends.
 * `issues` (those no form tab owns) are listed under it.
 */
export function JsonTab({ draft, setDraft, kind, issues, id }: TabProps) {
  const locked = useLocked();
  const hostRef = useRef<HTMLDivElement>(null);
  const maxLines = useFitLines(hostRef, locked ? BELOW : BELOW + ERROR_LINE);
  /** `error` (shown) and `held` (for Save) are set while the text does not parse to an object. */
  const [state, setState] = useEditingState<JsonState>(() => stateOf(kind, draft, newKeyNotes()));

  // A draft changed elsewhere replaces the text, unless the text holds Save: what was typed stays.
  let current = state;
  if (draft !== state.synced) {
    const says = deepEqual(draftOf(kind, state.text, state.notes, state.synced), draft);
    current = state.held !== undefined || says ? { ...state, synced: draft } : stateOf(kind, draft, state.notes);
    setState(current);
  }
  usePending(locked ? undefined : current.held);

  const scope = scopeOfKind[kind];
  const plugins = useAllPlugins(scope && subsystemOf(scope)).data;
  const hidden = useMemo(() => (locked ? redactObject(draft, kind, plugins, id) : undefined), [locked, draft, kind, plugins, id]);
  const [revealed, setRevealed] = useReveal();
  // What the editor shows, and what Copy copies.
  const shown = hidden?.redacted ? pretty(revealed ? hidden.revealed : hidden.value) : current.text;

  /** `text` from the editor (`notes`: those it was written with, new ones on leaving); taken when it parses and says a draft. */
  function change(text: string, notes: KeyNotes = current.notes) {
    const field = t('editor.json.tab');
    const parsed = parse(text);
    if (!parsed.ok) {
      const held = parsed.notObject ? t('ui.pending.jsonType', { field, type: 'object' }) : t('ui.pending.json', { field });
      setState((s) => ({ ...s, text, notes, error: parsed.error, held }));
      return;
    }
    // A number JSON.parse would round is not taken: what the text shows is what would be sent.
    const inexact = inexactNumberIn(text);
    if (inexact !== undefined) {
      setState((s) => ({ ...s, text, notes, error: t('json.inexact', { number: inexact }), held: t('ui.pending.inexact', { field, text: inexact }) }));
      return;
    }
    // Only text that may hold a note is walked (a keystroke in a large object would walk all of it).
    const back = mayHoldNotes(text) ? unveilKeys(kind, parsed.value, notes, current.synced) : ({ ok: true, value: parsed.value } as const);
    if (!back.ok) {
      const { problem } = back;
      setState((s) => ({ ...s, text, notes, error: problem, held: t('ui.pending.problem', { field, problem }) }));
      return;
    }
    setState((s) => ({ ...s, text, notes, synced: back.value, error: undefined, held: undefined }));
    setDraft(back.value);
  }

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(shown);
      // The masked text says so: the clipboard has the mask characters, not the secrets.
      // The toast says what the clipboard lacks: secrets Show secrets would add, or a never-shown key.
      // While editing that is read from the text copied: notes for keys, and no key typed in.
      const without = hidden ? copiedWithout(hidden, revealed) : copiedWithoutKey(shown) ? 'neverShown' : undefined;
      toast.success(without === 'masked' ? t('json.copiedMasked') : without === 'neverShown' ? t('json.copiedNoKey') : t('json.copied'));
    } catch (err) {
      toast.error(t('json.copyFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const singular = registry[kind].singular;
  // Whether Format would change anything: once per draft and text, and without walking a draft whose
  // text can hold nothing to veil (an SSL's key slots are veiled whatever their text).
  const formatted = useMemo(() => {
    if (current.error !== undefined) return false;
    const tidy = kind === 'ssls' || mayHoldKeys(current.text) ? veilKeys(kind, draft, current.notes, false) : { value: draft, complete: true };
    return tidy.complete && current.text === pretty(tidy.value);
  }, [kind, draft, current.notes, current.text, current.error]);
  return (
    <div className="ed-json">
      <div className="ed-json__bar">
        <p className="ed-json__hint">{t('editor.json.hint', { kind: singular })}</p>
        <div className="ed-json__tools">
          {hidden?.revealable && (
            <Button size="sm" variant="ghost" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
              {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
            </Button>
          )}
          {!locked && (
            <Button size="sm" variant="ghost" icon={<WandSparkles size={13} />} disabled={formatted || current.error !== undefined} onClick={() => setState(stateOf(kind, draft, current.notes))}>
              {t('editor.json.format')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
            {t('json.copy')}
          </Button>
        </div>
      </div>
      <div
        ref={hostRef}
        onBlur={(e) => {
          // Leaving the editor: a key typed or pasted here becomes a note, so no key rests on the page
          // outside the text being typed (fix round 1, R1): a whole key block in the raw text, whether or
          // not it parses or is held (the text then goes the usual way); else a key the draft holds with
          // no note yet. Nothing else about the text changes.
          if (locked || e.currentTarget.contains(e.relatedTarget)) return;
          const typed = veilTypedText(current.text, current.notes);
          if (typed.veiled) change(typed.text, typed.notes);
          else if (current.held === undefined && (kind === 'ssls' || mayHoldKeys(current.text)) && !veilKeys(kind, draft, current.notes, false).complete) {
            setState(stateOf(kind, draft, current.notes));
          }
        }}
      >
        <CodeEditor
          value={shown}
          onChange={change}
          language="json"
          minLines={Math.min(MIN_LINES, maxLines)}
          maxLines={maxLines}
          aria-label={t('editor.json.label', { kind: singular })}
          aria-invalid={!locked && current.held !== undefined}
        />
      </div>
      <div className={locked ? undefined : 'ed-json__status'} aria-live="polite">
        {current.error !== undefined && <p className="ed-json__error mono">{current.error}</p>}
      </div>
      {issues.length > 0 && (
        <section className="ed-issues" aria-label={t('editor.issues')}>
          <h3 className="ed-issues__title">{t('editor.issues')}</h3>
          <ul className="ed-issues__list">
            {issues.map((issue, i) => (
              <li key={i} className="ed-issues__item">
                {issue.path !== '' && <code className="ed-issues__path mono">{issue.path}</code>}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
