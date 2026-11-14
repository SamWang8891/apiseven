import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { CodeEditor, Field, Textarea, useLocked, usePending, useReveal } from '../../ui';
import type { Node } from '../analyze';
import { useEncryptPaths, useFieldError, useFieldId, useFieldName } from '../context';
import { redactSecrets } from '../model';
import { jsonType } from '../node';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import type { FieldProps } from './types';

const toText = (v: unknown): string => (v === undefined ? '' : (JSON.stringify(v, null, 2) ?? ''));

/** Whether `text` is `value` written as JSON (so a new value from outside need not replace it). */
function says(text: string, value: unknown): boolean {
  if (text.trim() === '') return value === undefined;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
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
  const [text, setText] = useState(() => toText(value));
  /** Why the text typed is not emitted: shown on the field, and held for Save. */
  const [invalid, setInvalid] = useState<{ error: string; held: string }>();
  usePending(locked ? undefined : invalid?.held);
  const [synced, setSynced] = useState(value);
  const [revealed, setRevealed] = useReveal();
  const encrypt = useEncryptPaths();
  const hidden = useMemo(() => (locked ? redactSecrets(value, path, encrypt) : undefined), [locked, value, path, encrypt]);
  // A new value from outside replaces the text, unless the text holds Save: what was typed stays.
  if (!Object.is(value, synced)) {
    setSynced(value);
    if (invalid === undefined && !says(text, value)) setText(toText(value));
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
    const shown = hidden && !revealed ? toText(hidden.value) : toText(value);
    return (
      <div className="sf-reveal">
        <Textarea id={id} label={label} help={fullHelp} error={placed} required={required} mono rows={2} value={shown} onChange={() => {}} />
        {hidden?.redacted && (
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

  function edit(next: string) {
    setText(next);
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
    const types = typesOf(node);
    if (types && !hasType(types, parsed)) {
      const type = types.join(' | ');
      setInvalid({ error: t('sf.json.type', { type }), held: t('ui.pending.jsonType', { field: fieldName, type }) });
      return;
    }
    setInvalid(undefined);
    onChange(name, parsed);
  }

  return (
    <Field label={label} help={fullHelp} error={invalid?.error ?? placed} required={required} controlId={id}>
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
    </Field>
  );
}
