import type { Item } from '../api/types';
import type { Ctx } from '../resources/ctx';
import type { ColumnDef } from '../resources/registry';

export interface SortRule {
  id: string;
  desc: boolean;
}

/** `undefined`, `null`, `''` and `[]`: shown as — and sorted last in both directions. */
export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

const collator = new Intl.Collator(undefined, { numeric: true });

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * Orders two non-empty values: numbers (and booleans, false first) numerically, everything else
 * by its text with natural number order (`r2` before `r10`); arrays by their joined text.
 */
export function compareValues(a: unknown, b: unknown): number {
  const numeric = (v: unknown): v is number | boolean => typeof v === 'number' || typeof v === 'boolean';
  if (numeric(a) && numeric(b)) return Number(a) - Number(b);
  return collator.compare(text(a), text(b));
}

/**
 * A sorted copy: by the first rule, ties broken by the next, then by the given order. Rules
 * naming no column are skipped. Each accessor runs once per item and rule.
 */
export function sortItems(items: Item[], sort: SortRule[], columns: ColumnDef[], ctx: Ctx): Item[] {
  const rules = sort.flatMap((rule) => {
    const column = columns.find((c) => c.id === rule.id);
    return column ? [{ column, sign: rule.desc ? -1 : 1 }] : [];
  });
  if (rules.length === 0) return items;
  const keyed = items.map((item) => ({ item, keys: rules.map(({ column }) => column.accessor(item, ctx)) }));
  keyed.sort((x, y) => {
    for (let i = 0; i < rules.length; i++) {
      const a = x.keys[i];
      const b = y.keys[i];
      const emptyA = isEmptyValue(a);
      const emptyB = isEmptyValue(b);
      if (emptyA || emptyB) {
        if (emptyA && emptyB) continue;
        return emptyA ? 1 : -1;
      }
      const order = compareValues(a, b) * (rules[i]?.sign ?? 1);
      if (order !== 0) return order;
    }
    return 0;
  });
  return keyed.map((k) => k.item);
}

/**
 * The sort after a header click. A plain click makes the column the only rule, cycling
 * ascending → descending → unsorted. Shift-click adds the column as a further rule, then flips it,
 * then removes it, leaving the other rules alone.
 */
export function nextSort(sort: SortRule[], id: string, multi: boolean): SortRule[] {
  const current = sort.find((rule) => rule.id === id);
  if (multi) {
    if (!current) return [...sort, { id, desc: false }];
    if (!current.desc) return sort.map((rule) => (rule.id === id ? { id, desc: true } : rule));
    return sort.filter((rule) => rule.id !== id);
  }
  if (sort.length !== 1 || !current) return [{ id, desc: false }];
  return current.desc ? [] : [{ id, desc: true }];
}
