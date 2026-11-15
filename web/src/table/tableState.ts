import { useCallback, useMemo, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { ColumnDef } from '../resources/registry';
import type { SortRule } from './sort';

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export type Density = 'comfortable' | 'compact';

/** What a table remembers per kind (or per embedded table): columns, widths, sort, page size, density. */
export interface TableState {
  /** Shown column ids. */
  visible: string[];
  /** Every column id, hidden ones included, in display order. */
  order: string[];
  /** Widths the user dragged, in px; columns without one use their default. */
  widths: Record<string, number>;
  sort: SortRule[];
  pageSize: PageSize;
  density: Density;
}

export const MIN_COLUMN_WIDTH = 60;
/** The widest a column gets from the keyboard (a drag is not capped). */
export const MAX_COLUMN_WIDTH = 1200;

/** localStorage key of a table's state; `key` is the kind, or an embedded table's stateKey. */
export const tableStorageKey = (key: string): string => `apiseven.table.${key}`;

export function defaultTableState(columns: ColumnDef[]): TableState {
  return {
    visible: columns.filter((c) => c.defaultVisible).map((c) => c.id),
    order: columns.map((c) => c.id),
    widths: {},
    sort: [],
    pageSize: 50,
    density: 'comfortable',
  };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Stored state checked against the current columns: ids no column has any more are dropped,
 * columns the stored order has never seen are appended (and shown when visible by default), and
 * anything malformed falls back to its default. At least one column stays visible.
 */
export function normalizeTableState(raw: unknown, columns: ColumnDef[]): TableState {
  const defaults = defaultTableState(columns);
  if (!isObj(raw)) return defaults;
  const known = new Set(defaults.order);

  const storedOrder = [...new Set(strings(raw.order))].filter((id) => known.has(id));
  const seen = new Set(storedOrder);
  const fresh = columns.filter((c) => !seen.has(c.id));
  const order = [...storedOrder, ...fresh.map((c) => c.id)];

  let visible = [...new Set(strings(raw.visible))].filter((id) => seen.has(id));
  visible = [...visible, ...fresh.filter((c) => c.defaultVisible).map((c) => c.id)];
  if (visible.length === 0) visible = defaults.visible.length > 0 ? defaults.visible : order.slice(0, 1);

  const widths: Record<string, number> = {};
  if (isObj(raw.widths)) {
    for (const [id, width] of Object.entries(raw.widths)) {
      if (known.has(id) && typeof width === 'number' && Number.isFinite(width) && width >= MIN_COLUMN_WIDTH) widths[id] = Math.round(width);
    }
  }

  const sort: SortRule[] = [];
  if (Array.isArray(raw.sort)) {
    for (const rule of raw.sort) {
      if (isObj(rule) && typeof rule.id === 'string' && known.has(rule.id) && !sort.some((r) => r.id === rule.id)) {
        sort.push({ id: rule.id, desc: rule.desc === true });
      }
    }
  }

  const pageSize = PAGE_SIZES.find((size) => size === raw.pageSize) ?? defaults.pageSize;
  const density: Density = raw.density === 'compact' ? 'compact' : 'comfortable';
  return { visible, order, widths, sort, pageSize, density };
}

function read(key: string): unknown {
  try {
    const text = localStorage.getItem(tableStorageKey(key));
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function write(key: string, state: TableState | undefined): void {
  try {
    if (state === undefined) localStorage.removeItem(tableStorageKey(key));
    else localStorage.setItem(tableStorageKey(key), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the state still works for this page.
  }
}

/**
 * A table's remembered state, persisted at localStorage `apiseven.table.<key>`. Returns the state,
 * a function to change part of it, and one to go back to the defaults (forgetting what was stored).
 */
export function useTableState(
  key: string,
  columns: ColumnDef[],
): [TableState, (patch: Partial<TableState>) => void, () => void] {
  // The raw stored value, re-read when the key changes; normalised against the columns on use.
  const [stored, setStored] = useState(() => ({ key, raw: read(key) }));
  if (stored.key !== key) setStored({ key, raw: read(key) });

  const state = useMemo(() => normalizeTableState(stored.raw, columns), [stored.raw, columns]);

  const patch = useCallback(
    (change: Partial<TableState>) =>
      setStored((prev) => {
        const next = { ...normalizeTableState(prev.raw, columns), ...change };
        write(prev.key, next);
        return { key: prev.key, raw: next };
      }),
    [columns],
  );

  const reset = useCallback(
    () =>
      setStored((prev) => {
        write(prev.key, undefined);
        return { key: prev.key, raw: undefined };
      }),
    [],
  );

  return [state, patch, reset];
}
