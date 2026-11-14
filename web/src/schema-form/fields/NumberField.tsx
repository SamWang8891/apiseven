import { Input, NumberInput } from '../../ui';
import type { NumberNode } from '../analyze';
import { useFieldError, useFieldId } from '../context';
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
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const common = { id, label, help, error, required, placeholder: placeholderOf(prop), 'aria-label': label ? undefined : ariaLabel };

  if (node.orText) {
    const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    return (
      <Input
        {...common}
        spellCheck={false}
        autoComplete="off"
        value={text}
        onChange={(e) => onChange(name, parseNumberOrText(e.target.value, node.integer))}
      />
    );
  }
  const step = node.integer ? 1 : 0;
  const min = node.min === undefined ? undefined : node.exclusiveMin ? (node.integer ? Math.floor(node.min) + step : undefined) : node.min;
  const max = node.max === undefined ? undefined : node.exclusiveMax ? (node.integer ? Math.ceil(node.max) - step : undefined) : node.max;
  return (
    <NumberInput
      {...common}
      integer={node.integer}
      min={min}
      max={max}
      value={typeof value === 'number' ? value : undefined}
      onChange={(v) => onChange(name, v)}
    />
  );
}
