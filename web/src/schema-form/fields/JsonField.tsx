import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { CodeEditor, Field, Textarea, useLocked, usePending, useReveal } from '../../ui';
import { inexactNumberIn } from '../../ui/decimal';
import type { Node } from '../analyze';
import { useEncryptPaths, useFieldError, useFieldId, useFieldName } from '../context';
import { mayHoldNotes, newKeyNotes, unveilValue, veilTypedText, veilValue, type KeyNotes } from '../../schema/keyNotes';
import { hideNeverShown, isNeverShownName, keyPath, redactSecrets } from '../../schema/secrets';
import { jsonType } from '../node';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import type { FieldProps } from './types';

const toText = (v: unknown): string => (v === undefined ? '' : (JSON.stringify(v, null, 2) ?? ''));

/** The text for `value` while editing: every value never shown as a note (schema/keyNotes.ts), made with `notes`; `under`, the property it sits under. */
function veiledText(value: unknown, notes: KeyNotes, under: string | undefined): { text: string; notes: KeyNotes } {
  const veiled = veilValue(value, notes, { under });
  return { text: toText(veiled.value), notes: veiled.notes };
}

/** Whether `text` is `value` written as JSON, its notes read back (so a new value from outside need not replace it). */
function says(text: string, value: unknown, notes: KeyNotes, under: string | undefined): boolean {
  if (text.trim() === '') return value === undefined;
  try {
    const back = unveilValue(JSON.parse(text), notes, { under, before: value });
    return back.ok && JSON.stringify(back.value) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/** The JSON types the field's value must have, where the schema says (a map is an object); undefined: any. */
function typesOf(node: Node): string[] | undefined {
  if (node.kind === 'map') return ['object'];
  if (node.kind !== 'json') return undefined;
  const type: unknown = node.schema.type;
  if (typeof type === 'string') return [type];
  return Array.isArray(type) && type.every((x): x is string => typeof x === 'string') ? type : undefined;
}

const hasType = (types: string[], v: unknown): boolean => {
  const type = jsonType(v);
  return types.includes(type) || (type === 'integer' && types.includes('number'));
};

/**
 * The fallback: an inline JSON editor for a value the form has no fields for, checked against its
 * sub-schema. Text that does not parse stays here with an error and is not emitted, so the last
 * valid value stands, and Save waits for it (usePending); so does JSON of another type than the
 * schema's (or a map's object). Empty text deletes the key. Locked, the JSON is read-only text with its secrets
 * masked (encrypt paths, secret-named keys), behind the same reveal as a secret input.
 */
export function JsonField({
  node,
  value,
  name,
  path,
  onChange,
  prop,
  required,
  ariaLabel,
  schema,
  note,
}: FieldProps & { schema?: Obj; note?: string }) {
  const locked = useLocked();
  const id = useFieldId(path);
  const placed = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const fieldName = useFieldName(path);
  // While editing, what is never shown (a PEM private key, a client_key) is a note in the text (fix round 1, R1).
  const under = keyPath(path).at(-1);
  const [shownText, setShownText] = useState(() => veiledText(value, newKeyNotes(), under));
  const { text, notes } = shownText;
  /** Why the text typed is not emitted: shown on the field, and held for Save. */
  const [invalid, setInvalid] = useState<{ error: string; held: string }>();
  usePending(locked ? undefined : invalid?.held);
  const [synced, setSynced] = useState(value);
  const [revealed, setRevealed] = useReveal();
  const encrypt = useEncryptPaths();
  // A never-shown value (a client_key, at or below this field) stays masked when the rest is shown.
  const hidden = useMemo(() => {
    if (!locked) return undefined;
    const never = hideNeverShown(value, keyPath(path).some(isNeverShownName));
    const masked = redactSecrets(never.value, path, encrypt);
    return { value: masked.value, revealed: never.value, redacted: masked.redacted || never.hidden, revealable: masked.redacted };
  }, [locked, value, path, encrypt]);
  // A new value from outside replaces the text, unless the text holds Save: what was typed stays.
  if (!Object.is(value, synced)) {
    setSynced(value);
    if (invalid === undefined && !says(text, value, notes, under)) setShownText(veiledText(value, notes, under));
  }

  const key = prop?.key ?? ariaLabel ?? path;
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const fullHelp = note ? (
    <>
      <span className="sf-note-line">{note}</span>
      {help}
    </>
  ) : (
    help
  );

  if (locked) {
    // The stored value, never text typed before the lock (it could hold a secret in clear).
    const shown = hidden?.redacted ? toText(revealed ? hidden.revealed : hidden.value) : toText(value);
    return (
      <div className="sf-reveal">
        <Textarea id={id} label={label} help={fullHelp} error={placed} required={required} mono rows={2} value={shown} onChange={() => {}} />
        {hidden?.revealable && (
          <button
            type="button"
            className="sf-reveal__toggle"
            aria-label={revealed ? t('ui.secret.hide') : t('ui.secret.show')}
            aria-pressed={revealed}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
          </button>
        )}
      </div>
    );
  }

  /** `next` from the editor (`withNotes`: the notes it was written with, new ones on leaving). */
  function edit(next: string, withNotes: KeyNotes = notes) {
    setShownText({ text: next, notes: withNotes });
    if (next.trim() === '') {
      setInvalid(undefined);
      onChange(name, undefined);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch (e) {
      setInvalid({ error: t('sf.json.invalid', { error: e instanceof Error ? e.message : String(e) }), held: t('ui.pending.json', { field: fieldName }) });
      return;
    }
    // A number JSON.parse would round is not taken: what the text shows is what would be sent.
    const inexact = inexactNumberIn(next);
    if (inexact !== undefined) {
      setInvalid({ error: t('json.inexact', { number: inexact }), held: t('ui.pending.inexact', { field: fieldName, text: inexact }) });
      return;
    }
    const types = typesOf(node);
    if (types && !hasType(types, parsed)) {
      const type = types.join(' | ');
      setInvalid({ error: t('sf.json.type', { type }), held: t('ui.pending.jsonType', { field: fieldName, type }) });
      return;
    }
    // Each note back to the key it stands for; a note that stands for none (or twice) holds the text.
    const back = mayHoldNotes(next, withNotes.session) ? unveilValue(parsed, withNotes, { under, before: synced }) : ({ ok: true, value: parsed } as const);
    if (!back.ok) {
      setInvalid({ error: back.problem, held: t('ui.pending.problem', { field: fieldName, problem: back.problem }) });
      return;
    }
    setInvalid(undefined);
    onChange(name, back.value);
  }

  /**
   * Leaving the editor: every key text typed or pasted here becomes a note (schema/keyNotes.ts rule 3),
   * whether or not the text parses or is held; the text then goes the usual way, and nothing else about
   * it changes.
   */
  function leave() {
    const typed = veilTypedText(text, notes, { under });
    if (typed.veiled) edit(typed.text, typed.notes);
  }

  return (
    <Field label={label} help={fullHelp} error={invalid?.error ?? placed} required={required} controlId={id}>
      <div onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && leave()}>
        <CodeEditor
          language="json"
          jsonSchema={schema}
          value={text}
          onChange={edit}
          minLines={3}
          maxLines={16}
          aria-label={t('sf.json.label', { key })}
          aria-invalid={invalid !== undefined}
        />
      </div>
    </Field>
  );
}
