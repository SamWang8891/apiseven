import { holdsPrivateKey } from '../../schema/secrets';
import { Select } from '../../ui';
import type { Node } from '../analyze';
import { useFieldError, useFieldId, useStoredAt, useStoredKnown } from '../context';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import { placeholderOf } from './hints';
import { SecretText } from './SecretText';
import type { FieldProps } from './types';

const keyOf = (v: unknown): string => JSON.stringify(v) ?? 'undefined';
/** What a value reads as: an option's label. */
const labelOf = (v: unknown): string => (typeof v === 'string' ? v : keyOf(v));

/**
 * An enum (or const) of numbers, booleans or nulls: a select that writes the value with its type.
 * Text that holds a PEM private key, stored or in the value (APISIX takes `$env://…` text where the
 * schema gives no type, gzip's http_version), is never shown, as in a plain text field (SecretText);
 * text typed in its box is the member it names, else text (Codex final pass, X1); the stored value's own
 * text (Keep, an emptied box) is the stored value itself, `null` included (final pass 2b, V5).
 */
export function EnumField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<Extract<Node, { kind: 'enum' }>>) {
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const stored = useStoredAt(path);
  const storedKnown = useStoredKnown();
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const options = node.values.map((v) => ({ value: keyOf(v), label: labelOf(v) }));
  if (holdsPrivateKey(stored) || holdsPrivateKey(value)) {
    const storedText = stored === undefined || stored === '' ? undefined : labelOf(stored);
    /** The value text from SecretText's box stands for: the stored value, a member (found by index: `null` is one), or the text. */
    const valueOf = (text: string): unknown => {
      if (text === '') return undefined;
      if (text === storedText) return stored;
      const at = node.values.findIndex((v) => labelOf(v) === text);
      return at >= 0 ? node.values[at] : text;
    };
    return (
      <SecretText
        common={{ id, label, help, error, required, placeholder: placeholderOf(prop), 'aria-label': label ? undefined : ariaLabel }}
        name={prop?.key ?? ariaLabel ?? ''}
        value={value === undefined ? '' : labelOf(value)}
        stored={storedText}
        storedKnown={storedKnown}
        mono={false}
        rows={3}
        neverShown
        onText={(text) => onChange(name, valueOf(text))}
      />
    );
  }
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
