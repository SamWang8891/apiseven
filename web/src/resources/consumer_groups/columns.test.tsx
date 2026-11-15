// The consumer groups list: its columns, the member count among them.
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { sortItems } from '../../table/sort';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { consumerGroupColumns } from './columns';

function col(id: string): ColumnDef {
  const column = consumerGroupColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const PARTNERS = itemOf('partners', { name: 'partners', desc: 'External partners', plugins: { 'limit-count': { count: 1000, time_window: 3600 } }, labels: { tier: 'partner' } });
const STAFF = itemOf('staff', { name: 'staff', plugins: {} });
const EMPTY = itemOf('7', { plugins: {} });
const GROUPS = [PARTNERS, STAFF, EMPTY];
const consumer = (username: string, group_id?: unknown): Item => ({ id: username, value: { username, group_id } });
const CTX = ctxOf({ consumerGroups: GROUPS, consumers: [consumer('alice', 'partners'), consumer('ann', 'partners'), consumer('sam', 'staff'), consumer('bob'), consumer('num', 7)] });

function cell(id: string, item: Item, ctx: Ctx = CTX) {
  cleanup();
  renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return screen.getByTestId('cell');
}

describe('consumer group columns', () => {
  it('id, name, plugins, consumers and updated by default; desc and labels on demand', () => {
    expect(consumerGroupColumns.map((c) => c.id)).toEqual(['id', 'name', 'plugins', 'consumers', 'updated', 'desc', 'labels']);
    expect(consumerGroupColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['id', 'name', 'plugins', 'consumers', 'updated']);
    const widths = consumerGroupColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0);
    expect(widths).toBeLessThanOrEqual(1010 - 34 - 40);
  });

  it('consumers: how many consumers are in the group (an integer group_id counts), sorted as a number', () => {
    expect(col('consumers').accessor(PARTNERS, CTX)).toBe(2);
    expect(col('consumers').accessor(STAFF, CTX)).toBe(1);
    expect(col('consumers').accessor(EMPTY, CTX)).toBe(1);
    expect(sortItems(GROUPS, [{ id: 'consumers', desc: true }], consumerGroupColumns, CTX).map((i) => i.id)).toEqual(['partners', 'staff', '7']);
    expect(cell('consumers', PARTNERS)).toHaveTextContent('2');
  });

  it('consumers: "loading…" (no count) until the consumers have loaded', () => {
    const loading = ctxOf({ ...CTX, loaded: { consumers: false } });
    expect(col('consumers').accessor(PARTNERS, loading)).toBeUndefined();
    expect(cell('consumers', PARTNERS, loading)).toHaveTextContent(t('picker.loading'));
  });

  it('plugins by name; the id in monospace', () => {
    expect(col('plugins').accessor(PARTNERS, CTX)).toEqual(['limit-count']);
    expect(cell('plugins', STAFF)).toHaveTextContent(t('ui.empty'));
    expect(col('id').mono).toBe(true);
  });
});
