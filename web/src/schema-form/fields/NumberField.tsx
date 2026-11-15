import { Input, NumberInput, useEditingState, useLocked, type InputProps } from '../../ui';
import type { NumberNode } from '../analyze';
import { useFieldError, useFieldId, useFieldName } from '../context';
import { parseNumberOrText } from '../model';
import { FieldLabel } from './chrome';
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

  if (node.orText) return <NumberOrText common={common} value={value} integer={node.integer} locked={locked} onChange={(v) => onChange(name, v)} />;
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
 */
function NumberOrText({ common, value, integer, locked, onChange }: { common: InputProps; value: unknown; integer: boolean; locked: boolean; onChange: (v: number | string | undefined) => void }) {
  // What was typed belongs to the editing session (Save and Discard end it).
  const [typed, setTyped] = useEditingState<string | undefined>(undefined);
  const text = !locked && typed !== undefined && Object.is(parseNumberOrText(typed, integer), value) ? typed : textOf(value);
  return (
    <Input
      {...common}
      spellCheck={false}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setTyped(e.target.value);
        onChange(parseNumberOrText(e.target.value, integer));
      }}
    />
  );
}
