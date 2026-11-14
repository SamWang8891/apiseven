import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { CodeEditor, Field, Textarea, useLocked } from '../../ui';
import { useEncryptPaths, useFieldError, useFieldId } from '../context';
import { redactSecrets } from '../model';
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

/**
 * The fallback: an inline JSON editor for a value the form has no fields for, checked against its
 * sub-schema. Text that does not parse stays here with an error and is not emitted, so the last
 * valid value stands; empty text deletes the key. Locked, the JSON is read-only text with its secrets
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
  const [text, setText] = useState(() => toText(value));
  const [invalid, setInvalid] = useState<string>();
  const [synced, setSynced] = useState(value);
  const [revealed, setRevealed] = useState(false);
  const encrypt = useEncryptPaths();
  const hidden = useMemo(() => (locked ? redactSecrets(value, path, encrypt) : undefined), [locked, value, path, encrypt]);
  if (!Object.is(value, synced)) {
    setSynced(value);
    if (!says(text, value)) {
      setText(toText(value));
      setInvalid(undefined);
    }
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
    try {
      const parsed: unknown = JSON.parse(next);
      setInvalid(undefined);
      onChange(name, parsed);
    } catch (e) {
      setInvalid(t('sf.json.invalid', { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <Field label={label} help={fullHelp} error={invalid ?? placed} required={required} controlId={id}>
      <CodeEditor language="json" jsonSchema={schema} value={text} onChange={edit} minLines={3} maxLines={16} aria-label={t('sf.json.label', { key })} />
    </Field>
  );
}
