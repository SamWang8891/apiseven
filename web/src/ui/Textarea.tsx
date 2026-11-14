import type { ComponentProps } from 'react';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import './input.css';

/** Taller text scrolls, locked or not; a locked value that scrolls is made keyboard-focusable. */
const MAX_LINES = 12;

/** Height of `rows` lines of text in a textarea or its locked value (18px lines, 14px padding + border). */
const minHeight = (rows: number) => ({ minHeight: rows * 18 + 14 });

export type TextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'children'> &
  FieldProps & {
    value: string;
    onChange: (v: string) => void;
    mono?: boolean;
  };

export function Textarea({ label, help, error, required, htmlFor, mono, id, value, onChange, rows = 4, className, ...native }: TextareaProps) {
  const locked = useLocked();
  const ids = useFieldIds(id ?? htmlFor, { help, error });
  const field = { label, help, error, required, htmlFor: locked ? undefined : ids.id };

  if (locked) {
    const scrolls = value.split('\n').length > MAX_LINES || value.length > MAX_LINES * 100;
    return (
      <Field {...field}>
        <ReadOnlyValue mono={mono} className="ro-value--block" tabIndex={scrolls ? 0 : undefined} style={minHeight(rows)}>
          {value}
        </ReadOnlyValue>
      </Field>
    );
  }

  return (
    <Field {...field}>
      <textarea
        {...native}
        id={ids.id}
        rows={rows}
        style={{ ...minHeight(rows), ...native.style }}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        spellCheck={mono ? false : native.spellCheck}
        className={['ui-input ui-textarea', mono && 'mono', className].filter(Boolean).join(' ')}
      />
    </Field>
  );
}
