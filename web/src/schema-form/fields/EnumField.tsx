import { Select } from '../../ui';
import type { Node } from '../analyze';
import { useFieldError, useFieldId } from '../context';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import { placeholderOf } from './hints';
import type { FieldProps } from './types';

const keyOf = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** An enum (or const) of numbers, booleans or nulls: a select that writes the value with its type. */
export function EnumField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<Extract<Node, { kind: 'enum' }>>) {
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const options = node.values.map((v) => ({ value: keyOf(v), label: typeof v === 'string' ? v : keyOf(v) }));
  return (
    <Select
      id={id}
      label={label}
      help={help}
      error={error}
      required={required}
      aria-label={label ? undefined : ariaLabel}
      placeholder={placeholderOf(prop)}
      clearable={!required}
      value={value === undefined ? undefined : keyOf(value)}
      options={options}
      onChange={(key) => onChange(name, key === undefined ? undefined : node.values.find((v) => keyOf(v) === key))}
    />
  );
}
