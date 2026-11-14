import { Input, Select, Textarea, useLocked } from '../../ui';
import type { StringNode } from '../analyze';
import { useFieldError, useFieldId } from '../context';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import { placeholderOf } from './hints';
import type { FieldProps } from './types';

/** Enums longer than this get a search box. */
const SEARCHABLE = 8;

/** Text: a select for an enum, a textarea for PEM/Lua/long text, a masked input for a secret. Empty text deletes the key. */
export function StringField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<StringNode>) {
  const locked = useLocked();
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const placeholder = placeholderOf(prop);
  const text = typeof value === 'string' ? value : '';
  const emit = (next: string) => onChange(name, next === '' ? undefined : next);
  const common = { id, label, help, error, required, placeholder, 'aria-label': label ? undefined : ariaLabel };

  if (node.enum) {
    return (
      <Select
        {...common}
        value={typeof value === 'string' ? value : undefined}
        options={node.enum.map((v) => ({ value: v, label: v }))}
        onChange={(v) => onChange(name, v)}
        clearable={!required}
        searchable={node.enum.length > SEARCHABLE}
      />
    );
  }
  // A multi-line secret (a PEM private key) is edited in a textarea, but read masked.
  if (node.multiline && !(locked && node.secret)) {
    return <Textarea {...common} mono={node.mono} rows={node.mono ? 6 : 3} value={text} onChange={emit} />;
  }
  return <Input {...common} mono={node.mono} secret={node.secret} value={text} onChange={(e) => emit(e.target.value)} />;
}
