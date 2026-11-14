import { Switch as RadixSwitch } from 'radix-ui';
import type { ComponentProps } from 'react';
import { t } from '../i18n';
import { Badge } from './Badge';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import './toggle.css';

export type SwitchProps = Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'children' | 'type'> &
  FieldProps & {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** Text beside the switch (and in the locked badge) when on; default "On". */
    onLabel?: string;
    /** Text beside the switch (and in the locked badge) when off; default "Off". */
    offLabel?: string;
  };

export function Switch({ label, help, error, required, htmlFor, id, checked, onChange, onLabel, offLabel, className, ...native }: SwitchProps) {
  const locked = useLocked();
  const ids = useFieldIds(id ?? htmlFor, { help, error });
  const text = checked ? (onLabel ?? t('ui.on')) : (offLabel ?? t('ui.off'));
  const field = { label, help, error, required, htmlFor: locked ? undefined : ids.id };

  if (locked) {
    return (
      <Field {...field}>
        <ReadOnlyValue className="ro-value--badge">
          <Badge tone={checked ? 'ok' : 'neutral'}>{text}</Badge>
        </ReadOnlyValue>
      </Field>
    );
  }

  return (
    <Field {...field}>
      <span className="ui-toggle-row">
        <RadixSwitch.Root
          {...native}
          id={ids.id}
          checked={checked}
          onCheckedChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={['ui-switch', className].filter(Boolean).join(' ')}
        >
          <RadixSwitch.Thumb className="ui-switch__thumb" />
        </RadixSwitch.Root>
        <span className="ui-switch__text" aria-hidden="true">
          {text}
        </span>
      </span>
    </Field>
  );
}
