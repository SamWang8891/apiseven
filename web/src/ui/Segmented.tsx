import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import { Tooltip } from './Tooltip';
import { useTooltipsAvailable } from './tooltipContext';
import './toggle.css';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** Why it can't be chosen now: the disabled option's tooltip ("Choose a service above…"). */
  reason?: string;
}

export type SegmentedProps = Omit<FieldProps, 'htmlFor'> & {
  value: string;
  onChange: (v: string) => void;
  options: SegmentedOption[];
  id?: string;
};

/**
 * One of a few exclusive choices side by side (a radio group): click, or the arrow keys, which move
 * and choose at once; Tab stops on the chosen option only. Locked: the chosen label as text. A
 * disabled option stays readable and hoverable (aria-disabled), its `reason` in a tooltip and in its
 * accessible description (so a screen reader user, whom the arrow keys never take there, hears it too).
 */
export function Segmented({ label, help, error, required, value, onChange, options, id }: SegmentedProps) {
  const locked = useLocked();
  const tooltips = useTooltipsAvailable();
  const ids = useFieldIds(id, { help, error });
  const labelId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  if (locked) {
    return (
      <Field label={label} help={help} error={error} required={required}>
        <ReadOnlyValue>{options.find((o) => o.value === value)?.label ?? value}</ReadOnlyValue>
      </Field>
    );
  }

  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  function onKey(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.indexOf(index);
    const next = enabled[(at + step + enabled.length) % enabled.length] ?? index;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  }

  // Tab lands on the chosen option, or the first one that can be chosen when none is.
  const chosen = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = chosen >= 0 ? chosen : (enabled[0] ?? 0);

  return (
    <Field label={label === undefined ? undefined : <span id={labelId}>{label}</span>} help={help} error={error} required={required} controlId={ids.id}>
      <div
        id={ids.id}
        role="radiogroup"
        aria-labelledby={label === undefined ? undefined : labelId}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className="ui-segmented"
      >
        {options.map((option, i) => {
          const button = (
            <button
              key={option.value}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={option.value === value}
              tabIndex={i === tabStop ? 0 : -1}
              aria-disabled={option.disabled || undefined}
              aria-describedby={option.disabled && option.reason ? `${labelId}-why-${i}` : undefined}
              title={option.disabled && !tooltips ? option.reason : undefined}
              className="ui-segmented__option"
              onClick={() => !option.disabled && onChange(option.value)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {option.label}
            </button>
          );
          return option.disabled && option.reason && tooltips ? (
            <Tooltip key={option.value} content={option.reason}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
      {/* A disabled option's reason, for its accessible description: there whether or not its tooltip is open. */}
      {options.map((option, i) =>
        option.disabled && option.reason ? (
          <span key={option.value} id={`${labelId}-why-${i}`} className="ui-sr-only">
            {option.reason}
          </span>
        ) : null,
      )}
    </Field>
  );
}
