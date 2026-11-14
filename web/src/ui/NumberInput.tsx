import { useState, type ComponentProps, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { nameOfField, useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import { usePending } from './PendingContext';
import { ReadOnlyValue } from './ReadOnly';
import './input.css';

export type NumberInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'children'
> &
  FieldProps & {
    value: number | undefined;
    /** A number, or undefined when the field is cleared. Text that is not a number is not emitted. */
    onChange: (v: number | undefined) => void;
    min?: number;
    max?: number;
    /** Arrow Up/Down step; default 1. */
    step?: number;
    integer?: boolean;
    mono?: boolean;
    /** How a refused Save names the field while it shows text that is not a number; default: the label (if text) or aria-label. */
    fieldName?: string;
  };

type Problem = 'invalid' | 'whole' | 'inexact';
type Parsed = { ok: true; value: number | undefined } | { ok: false; message: string; problem: Problem };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const DECIMAL = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i;

/**
 * The number a decimal text denotes, written one way: its significant digits and a power of ten
 * ("1.50", "15e-1" and "1.5" are all "15e-1"). Two texts are the same number when these match.
 */
function decimalOf(text: string): string {
  const [, sign = '', int = '', frac = '', exp = '0'] = DECIMAL.exec(text) ?? [];
  const all = (int + frac).replace(/^0+/, '');
  if (all === '') return '0';
  const digits = all.replace(/0+$/, '');
  return `${sign === '-' ? '-' : ''}${digits}e${Number(exp) - frac.length + (all.length - digits.length)}`;
}

function parse(text: string, integer: boolean | undefined): Parsed {
  const s = text.trim();
  if (s === '') return { ok: true, value: undefined };
  const n = Number(s);
  if (!NUMBER.test(s) || !Number.isFinite(n)) return { ok: false, message: t('ui.number.invalid'), problem: 'invalid' };
  if (integer && !Number.isInteger(n)) return { ok: false, message: t('ui.number.integer'), problem: 'whole' };
  // The number emitted must be the one shown: not a rounded one (an integer past 2^53, more digits
  // than a double keeps). Ordinary text ("1.50", "1e3", ".5") reads back as the same number.
  if ((integer && !Number.isSafeInteger(n)) || decimalOf(s) !== decimalOf(String(n))) return { ok: false, message: t('ui.number.inexact'), problem: 'inexact' };
  return { ok: true, value: n };
}

const HELD: Record<Problem, string> = { invalid: 'ui.pending.notNumber', whole: 'ui.pending.notInteger', inexact: 'ui.pending.inexact' };

const format = (n: number | undefined): string => (n === undefined ? '' : String(n));

const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;

export function NumberInput({
  label, help, error, required, htmlFor, mono, id, value, onChange, min, max, step = 1, integer, fieldName, className, onKeyDown, ...native
}: NumberInputProps) {
  const locked = useLocked();
  // The text being edited, which may be mid-way ("-", "1.") or invalid ("abc").
  const [draft, setDraft] = useState(() => format(value));
  // The value `draft` was last reconciled with; a different incoming value replaces the draft.
  const [shown, setShown] = useState(value);
  if (!Object.is(value, shown)) {
    setShown(value);
    const parsed = parse(draft, integer);
    // Text that holds Save stays as typed: a value from outside never replaces it behind the user's back.
    if (parsed.ok && !Object.is(parsed.value, value)) setDraft(format(value));
  }

  const parsed = parse(draft, integer);
  // Text that is not a number is shown but not emitted: Save waits until it is one, or is cleared.
  const named = nameOfField(fieldName, label, native['aria-label']);
  usePending(locked || parsed.ok ? undefined : t(HELD[parsed.problem], { field: named, text: draft.trim() }));
  const rangeError =
    parsed.ok && parsed.value !== undefined
      ? min !== undefined && parsed.value < min
        ? t('ui.number.min', { min })
        : max !== undefined && parsed.value > max
          ? t('ui.number.max', { max })
          : undefined
      : undefined;
  const shownError = error ?? (parsed.ok ? rangeError : parsed.message);
  const ids = useFieldIds(id ?? htmlFor, { help, error: shownError });
  const field = { label, help, error: shownError, required, htmlFor: locked ? undefined : ids.id };

  if (locked) {
    return (
      <Field {...field} error={error}>
        <ReadOnlyValue mono={mono} className="ui-number">
          {format(value)}
        </ReadOnlyValue>
      </Field>
    );
  }

  function edit(text: string) {
    setDraft(text);
    const next = parse(text, integer);
    if (next.ok) onChange(next.value);
  }

  function stepBy(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const base = parsed.ok ? (parsed.value ?? 0) : (value ?? 0);
    let next = Number((base + (e.key === 'ArrowUp' ? step : -step)).toFixed(Math.max(decimals(step), decimals(base))));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setDraft(format(next));
    onChange(next);
  }

  return (
    <Field {...field}>
      <input
        {...native}
        id={ids.id}
        type="text"
        role="spinbutton"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        required={required}
        aria-valuenow={parsed.ok ? parsed.value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={ids.describedBy}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={stepBy}
        className={['ui-input ui-number', mono && 'mono', className].filter(Boolean).join(' ')}
      />
    </Field>
  );
}
