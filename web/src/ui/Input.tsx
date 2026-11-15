import { Eye, EyeOff } from 'lucide-react';
import type { ComponentProps } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked, useReveal } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import { LabelTip } from './Tooltip';
import './input.css';

const MASK = '••••••••';

export type InputProps = Omit<ComponentProps<'input'>, 'value' | 'children'> &
  FieldProps & {
    value?: string;
    /** Hosts, URIs, IDs, addresses. */
    mono?: boolean;
    /** Masks the value behind a reveal toggle, in the locked state too. */
    secret?: boolean;
  };

export function Input({ label, help, error, required, htmlFor, mono, secret, id, value, className, type, ...native }: InputProps) {
  const locked = useLocked();
  const ids = useFieldIds(id ?? htmlFor, { help, error });
  const [revealed, setRevealed] = useReveal();
  const field = { label, help, error, required, htmlFor: locked ? undefined : ids.id };

  const revealLabel = revealed ? t('ui.secret.hide') : t('ui.secret.show');
  const reveal = secret && (
    <LabelTip label={revealLabel}>
      <button type="button" className="ui-input__affix" aria-label={revealLabel} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
        {revealed ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
      </button>
    </LabelTip>
  );

  if (locked) {
    const shown = secret && value && !revealed ? MASK : value;
    return (
      <Field {...field}>
        {secret && value ? (
          <span className="ui-secret-ro">
            <ReadOnlyValue mono={mono || revealed}>{shown}</ReadOnlyValue>
            {reveal}
          </span>
        ) : (
          <ReadOnlyValue mono={mono}>{shown}</ReadOnlyValue>
        )}
      </Field>
    );
  }

  const input = (
    <input
      {...native}
      id={ids.id}
      value={value}
      type={secret ? (revealed ? 'text' : 'password') : type}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      spellCheck={mono || secret ? false : native.spellCheck}
      autoComplete={secret ? 'off' : native.autoComplete}
      className={[secret ? 'ui-input__bare' : 'ui-input', mono && 'mono', !secret && className].filter(Boolean).join(' ')}
    />
  );

  return (
    <Field {...field}>
      {secret ? (
        <div className={['ui-input ui-input--group', className].filter(Boolean).join(' ')} data-disabled={native.disabled || undefined}>
          {input}
          {reveal}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}
