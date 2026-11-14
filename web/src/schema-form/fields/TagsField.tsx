import { t } from '../../i18n';
import { TagInput } from '../../ui';
import { testPattern } from '../../schema/refs';
import type { ArrayNode, Node } from '../analyze';
import { useFieldError, useFieldId } from '../context';
import { parseNumberOrText } from '../model';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import { placeholderOf } from './hints';
import type { FieldProps } from './types';

const tagOf = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? ''));

/** Why a typed item is refused, if it is. */
function refusal(item: Node, tag: string): string | undefined {
  if (item.kind === 'number' && !item.orText) {
    const parsed = parseNumberOrText(tag, item.integer);
    if (typeof parsed !== 'number') return item.integer ? t('ui.number.integer') : t('sf.number.invalid');
    if (item.min !== undefined && (item.exclusiveMin ? parsed <= item.min : parsed < item.min)) return t(item.exclusiveMin ? 'sf.above' : 'sf.min', { min: item.min });
    if (item.max !== undefined && (item.exclusiveMax ? parsed >= item.max : parsed > item.max)) return t(item.exclusiveMax ? 'sf.below' : 'sf.max', { max: item.max });
  }
  const values = item.kind === 'string' ? item.enum : item.kind === 'enum' ? item.values.map(tagOf) : undefined;
  if (values && !values.includes(tag)) return t('sf.enum.invalid', { values: values.join(', ') });
  if (item.kind === 'string' && item.pattern && !testPattern(item.pattern, tag)) return t('sf.pattern.invalid', { pattern: item.pattern });
  return undefined;
}

/** The item a tag stands for, typed as the schema wants it. */
function itemOf(item: Node, tag: string): unknown {
  if (item.kind === 'number') return parseNumberOrText(tag, item.integer);
  if (item.kind === 'enum') return item.values.find((v) => tagOf(v) === tag);
  return tag;
}

/** A list of short values (strings, numbers, enum members) as tags; items are checked as they are typed. */
export function TagsField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<Extract<ArrayNode, { kind: 'array-scalar' }>>) {
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const mono = node.item.kind === 'string' ? node.item.mono : node.item.kind !== 'number';

  function change(tags: string[]) {
    // Items that were there keep their stored form; new ones are typed by the schema.
    const next = tags.map((tag) => items.find((x) => tagOf(x) === tag) ?? itemOf(node.item, tag));
    onChange(name, next.length === 0 && !required ? undefined : next);
  }

  return (
    <TagInput
      id={id}
      label={label}
      help={help}
      error={error}
      required={required}
      aria-label={label ? undefined : ariaLabel}
      placeholder={placeholderOf(prop)}
      mono={mono}
      value={items.map(tagOf)}
      onChange={change}
      validate={(tag) => refusal(node.item, tag)}
    />
  );
}
