import { Check, X } from 'lucide-react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import './toggle.css';

export type CheckboxProps = Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'children' | 'type'> &
  FieldProps & {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** The inline label beside the box. */
    children?: ReactNode;
  };

export function Checkbox({ label, help, error, required, htmlFor, id, checked, onChange, children, className, ...native }: CheckboxProps) {
  const locked = useLocked();
  const ids = useFieldIds(id ?? htmlFor, { help, error });

  if (locked) {
    return (
      <Field label={label} help={help} error={error} required={required}>
        <span className="ro-value ui-check-ro">
          <span className="ui-check-ro__mark" data-mark={checked ? 'checked' : 'unchecked'} aria-hidden="true">
            {checked ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
          </span>
          <span className="ui-sr-only">{checked ? t('ui.yes') : t('ui.no')}</span>
          {children !== undefined && <span>{children}</span>}
        </span>
      </Field>
    );
  }

  // With an inline label, the Field label (if any) heads the group and the inline one names the box;
  // either way the help/error are named after the box's id, which its aria-describedby points at.
  return (
    <Field
      label={label}
      help={help}
      error={error}
      required={required}
      htmlFor={children === undefined ? ids.id : undefined}
      controlId={ids.id}
    >
      <span className="ui-toggle-row">
        <RadixCheckbox.Root
          {...native}
          id={ids.id}
          checked={checked}
          onCheckedChange={(state) => onChange(state === true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={['ui-checkbox', className].filter(Boolean).join(' ')}
        >
          <RadixCheckbox.Indicator className="ui-checkbox__indicator">
            <Check aria-hidden="true" size={12} strokeWidth={3.5} />
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
        {children !== undefined && (
          <label className="ui-checkbox__label" htmlFor={ids.id}>
            {children}
          </label>
        )}
      </span>
    </Field>
  );
}
