// The compact constraint line under a field ("1–65535", "> 0, or text", "≤ 4096 characters") and the
// way defaults are written in placeholders. Pure.
import { t } from '../../i18n';
import type { Node, NumberNode, Prop } from '../analyze';

const LONG_PATTERN = 40;
const LONG_DEFAULT = 48;

function range(min: number | undefined, max: number | undefined, exclusiveMin?: boolean, exclusiveMax?: boolean): string | undefined {
  if (min !== undefined && max !== undefined && !exclusiveMin && !exclusiveMax) return t('sf.range', { min, max });
  const parts: string[] = [];
  if (min !== undefined) parts.push(t(exclusiveMin ? 'sf.above' : 'sf.min', { min }));
  if (max !== undefined) parts.push(t(exclusiveMax ? 'sf.below' : 'sf.max', { max }));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function numberHints(node: NumberNode): string[] {
  const out: string[] = [];
  const r = range(node.min, node.max, node.exclusiveMin, node.exclusiveMax);
  if (r) out.push(r);
  if (node.orText) out.push(t('sf.orText'));
  return out;
}

const quoted = (values: unknown[]) => values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');

/** What the schema asks of a value, beyond its type, in a few words each. */
export function constraintsOf(node: Node): string[] {
  switch (node.kind) {
    case 'number':
      return numberHints(node);
    case 'string': {
      const out: string[] = [];
      if (node.accepts) out.push(node.accepts.join(', '));
      const min = node.minLength !== undefined && node.minLength > 1 ? node.minLength : undefined;
      const length = range(min, node.maxLength);
      if (length) out.push(t('sf.chars', { range: length }));
      if (node.pattern) out.push(node.pattern.length <= LONG_PATTERN ? t('sf.pattern', { pattern: node.pattern }) : t('sf.patternLong'));
      return out;
    }
    case 'array-scalar':
    case 'array-object': {
      const out: string[] = [];
      const min = node.minItems !== undefined && node.minItems > 1 ? node.minItems : undefined;
      const count = range(min, node.maxItems);
      if (count) out.push(t('sf.items', { range: count }));
      if (node.unique) out.push(t('sf.unique'));
      if (node.kind === 'array-scalar') {
        const item = node.item;
        if (item.kind === 'string' && item.enum) out.push(t('sf.values', { values: quoted(item.enum) }));
        else if (item.kind === 'enum') out.push(t('sf.values', { values: quoted(item.values) }));
        // Tags are text anyway: an item that takes a number or text needs no "or text".
        else if (item.kind === 'number') out.push(...numberHints({ ...item, orText: false }));
        else out.push(...constraintsOf(item));
      }
      return out;
    }
    case 'map':
      return node.minProperties !== undefined && node.minProperties > 1 ? [t('sf.items', { range: t('sf.min', { min: node.minProperties }) })] : [];
    default:
      return [];
  }
}

/** A default as it reads in a placeholder or a hint: strings as they are, the rest as JSON, long ones cut. */
export function formatDefault(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.length > LONG_DEFAULT ? `${text.slice(0, LONG_DEFAULT - 1)}…` : text;
}

/** `default: 60` for a property with a default, else undefined. */
export function placeholderOf(prop: Prop | undefined): string | undefined {
  return prop && 'default' in prop ? t('sf.default', { value: formatDefault(prop.default) }) : undefined;
}
