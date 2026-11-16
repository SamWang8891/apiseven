import { useState } from 'react';
import { t } from '../../i18n';
import { holdsPrivateKey } from '../../schema/secrets';
import { Input, NumberInput, useEditingState, useLocked, usePending, type InputProps } from '../../ui';
import type { NumberNode } from '../analyze';
import { useFieldError, useFieldId, useFieldName, useStoredAt, useStoredKnown } from '../context';
import { INEXACT, parseNumberOrText } from '../model';
import { FieldLabel } from './chrome';
import { SecretText } from './SecretText';
import { useFieldHelp } from './help';
import { placeholderOf } from './hints';
import type { FieldProps } from './types';

/**
 * A number (bounds checked as typed; exclusive bounds of integers become inclusive ones). One that
 * also takes text (`["string","integer"]`, limit-count's count) is a text box that emits numbers
 * for numeric text and strings otherwise.
 */
export function NumberField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<NumberNode>) {
  const locked = useLocked();
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const fieldName = useFieldName(path);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const common = { id, label, help, error, required, placeholder: placeholderOf(prop), 'aria-label': label ? undefined : ariaLabel };

  if (node.orText) {
    return (
      <NumberOrText
        common={common}
        fieldName={fieldName}
        path={path}
        name={prop?.key ?? ariaLabel ?? ''}
        value={value}
        integer={node.integer}
        locked={locked}
        onChange={(v) => onChange(name, v)}
      />
    );
  }
  const step = node.integer ? 1 : 0;
  const min = node.min === undefined ? undefined : node.exclusiveMin ? (node.integer ? Math.floor(node.min) + step : undefined) : node.min;
  const max = node.max === undefined ? undefined : node.exclusiveMax ? (node.integer ? Math.ceil(node.max) - step : undefined) : node.max;
  return (
    <NumberInput
      {...common}
      fieldName={fieldName}
      integer={node.integer}
      min={min}
      max={max}
      value={typeof value === 'number' ? value : undefined}
      onChange={(v) => onChange(name, v)}
    />
  );
}

const textOf = (value: unknown): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : '');

/**
 * The text box of a number that also takes text. It shows what was typed while that reads as the
 * value ("1." is 1, on the way to "1.5"; "2.0" is 2), else the value; locked, always the value.
 * Numeric text a double would round (9007199254740993) is not emitted: it stays as typed, flagged,
 * and holds Save (as the kit NumberInput does), the value keeping its last good number meanwhile.
 * Text that holds a PEM private key, stored or entered, is never shown, as in a plain text field
 * (StringField, SecretText): a key typed or pasted into the box shows until the box is left (Codex
 * final pass, X1).
 */
function NumberOrText({ common, fieldName, path, name, value, integer, locked, onChange }: {
  common: InputProps & { id: string };
  fieldName: string;
  path: string;
  /** The property's name, for SecretText's buttons. */
  name: string;
  value: unknown;
  integer: boolean;
  locked: boolean;
  onChange: (v: number | string | undefined) => void;
}) {
  const stored = useStoredAt(path);
  const storedKnown = useStoredKnown();
  // What was typed belongs to the editing session (Save and Discard end it).
  const [typed, setTyped] = useEditingState<string | undefined>(undefined);
  /** Focus is in the box: a key being typed or pasted there shows until the box is left. */
  const [typing, setTyping] = useState(false);
  const parsed = typed === undefined ? undefined : parseNumberOrText(typed, integer);
  const inexact = !locked && typed !== undefined && parsed === INEXACT;
  usePending(inexact ? t('ui.pending.inexact', { field: fieldName, text: typed.trim() }) : undefined);
  const error = common.error ?? (inexact ? t('ui.number.inexact') : undefined);
  const take = (next: string) => {
    setTyped(next);
    const v = parseNumberOrText(next, integer);
    if (v !== INEXACT) onChange(v);
  };
  const storedText = textOf(stored) === '' ? undefined : textOf(stored);
  /** Text from SecretText's box: the stored value's own text (Keep, an emptied box) is the stored value itself, with its type (fix round 1, Y4). */
  const fromBox = (next: string) => {
    if (storedText === undefined || next !== storedText) return take(next);
    setTyped(undefined);
    onChange(stored as number | string);
  };
  if ((holdsPrivateKey(storedText) || holdsPrivateKey(value)) && !typing) {
    return (
      <SecretText
        common={{ ...common, error }}
        name={name}
        value={textOf(value)}
        stored={storedText}
        storedKnown={storedKnown}
        mono={false}
        rows={3}
        neverShown
        onText={fromBox}
      />
    );
  }
  const text = !locked && typed !== undefined && (inexact || Object.is(parsed, value)) ? typed : textOf(value);
  return (
    <Input
      {...common}
      error={error}
      spellCheck={false}
      autoComplete="off"
      value={text}
      onFocus={() => setTyping(true)}
      onBlur={() => setTyping(false)}
      onChange={(e) => take(e.target.value)}
    />
  );
}
