// The consumers list: its columns (the credentials count is fetched per row as it is shown) and
// quick filters.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { applyFilters, type FilterSelection } from '../../table/filter';
import { sortItems } from '../../table/sort';
import { ctxOf, itemOf } from '../../test/ctx';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { consumerColumns } from './columns';
import { consumerFilters, NO_GROUP } from './filters';

function col(id: string): ColumnDef {
  const column = consumerColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const item = (username: string, value: Record<string, unknown> = {}): Item => ({ id: username, value: { username, ...value } });
const ALICE = item('alice', { desc: 'Partner integration', group_id: 'partners', labels: { org: 'acme' }, plugins: { 'limit-count': { count: 1, time_window: 1, _meta: { disable: true } }, 'key-auth': { key: 'secret', _meta: { disable: true } } } });
const BOB = item('bob', { desc: 'Internal tooling' });
const CAROL = item('carol', { group_id: 'gone', labels: { org: 'beta' } });
const CONSUMERS = [ALICE, BOB, CAROL];
const CTX = ctxOf({ consumers: CONSUMERS, consumerGroups: [itemOf('partners', { name: 'Partners', plugins: {} })] });
const value = (id: string, it: Item, ctx: Ctx = CTX) => col(id).accessor(it, ctx);

function cell(id: string, it: Item, ctx: Ctx = CTX, admin: FakeAdminOptions = { counts: {} }) {
  cleanup();
  const r = renderWithProviders(<div data-testid="cell">{col(id).cell?.(it, ctx)}</div>, admin);
  return { el: screen.getByTestId('cell'), admin: r.admin };
}

describe('consumer columns', () => {
  it('lists the columns in order, the main ones visible by default, fitting a 1280px window', () => {
    expect(consumerColumns.map((c) => c.id)).toEqual(['username', 'group', 'plugins', 'credentials', 'updated', 'desc', 'labels', 'created']);
    expect(consumerColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['username', 'group', 'plugins', 'credentials', 'updated']);
    for (const column of consumerColumns) {
      expect(column.header, column.id).not.toMatch(/^column\./);
      expect(column.width, column.id).toBeGreaterThan(0);
    }
    const widths = consumerColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0);
    expect(widths).toBeLessThanOrEqual(1010 - 34 - 40);
  });

  it('username: a link to the consumer in monospace, its description underneath', () => {
    expect(value('username', ALICE)).toBe('alice');
    const { el } = cell('username', ALICE);
    const link = within(el).getByRole('link', { name: 'alice' });
    expect(link).toHaveAttribute('href', '/consumers/alice');
    expect(link).toHaveClass('mono');
    expect(el).toHaveTextContent('Partner integration');
  });

  it("group: the group's name linking to it; a missing group is flagged, but not while the groups load", () => {
    expect(value('group', ALICE)).toBe('Partners');
    expect(value('group', BOB)).toBeUndefined();
    expect(within(cell('group', ALICE).el).getByRole('link', { name: 'Partners' })).toHaveAttribute('href', '/consumer_groups/partners');
    expect(cell('group', CAROL).el).toHaveTextContent(t('cell.missing.consumer_groups', { id: 'gone' }));
    const loading = cell('group', CAROL, ctxOf({ ...CTX, loaded: { consumerGroups: false } })).el;
    expect(loading).toHaveTextContent('gone');
    expect(loading).not.toHaveTextContent(t('cell.missing.consumer_groups', { id: 'gone' }));
  });

  it("plugins: the consumer's own, by name (no config, so no key); off marked, but an auth plugin stored as off still signs in", () => {
    expect(value('plugins', ALICE)).toEqual(['key-auth', 'limit-count']);
    const { el } = cell('plugins', ALICE);
    const chips = [...el.querySelectorAll('.cell-plugin')].map((c) => c.textContent);
    expect(chips).toEqual([`key-auth${t('cell.plugin.stillSignsIn')}`, `limit-count${t('cell.plugin.off')}`]);
    expect(el.textContent).not.toContain('secret');
  });

  it("credentials: '…' while this consumer's credentials load, then how many; fetched for this row only, not sortable", async () => {
    expect(col('credentials').sortable).toBe(false);
    const { el, admin } = cell('credentials', ALICE, CTX, { counts: {}, credentials: { alice: [{ id: 'k1' }, { id: 'k2' }] } });
    // The glyph is for the eye; a screen reader hears the words.
    expect(el.querySelector('[aria-hidden="true"]')).toHaveTextContent('…');
    expect(el).toHaveTextContent(t('picker.loading'));
    await waitFor(() => expect(el).toHaveTextContent('2'));
    // The support probe, then this row's list.
    expect(admin.requests.map((r) => r.url.pathname.replace(/^.*\/apisix\/admin\//, ''))).toEqual(['credentials', 'consumers/alice/credentials']);
    // Not asked again when the window regains focus (one request per row would follow every focus).
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(admin.requests.filter((r) => r.url.pathname.endsWith('/consumers/alice/credentials'))).toHaveLength(1);
    // A consumer without a credentials directory: APISIX answers 404, which is none.
    const none = cell('credentials', BOB, CTX, { counts: {}, credentials: {} }).el;
    await waitFor(() => expect(none).toHaveTextContent('0'));
  });

  it('credentials: a list that fails to load shows a mark, not a number', async () => {
    const { el } = cell('credentials', ALICE, CTX, { counts: {}, replies: { 'consumers/alice/credentials': () => json(500, { error_msg: 'etcd down' }) } });
    await waitFor(() => expect(el.querySelector('.cell-count--error')).not.toBeNull());
    expect(el.querySelector('[aria-hidden="true"]')).toHaveTextContent('!');
    expect(el).toHaveTextContent(t('shell.countFailed', { error: 'HTTP 500: etcd down' }));
  });

  it('credentials: on an APISIX without credentials (its /credentials answers 404), "—" and no request per row', async () => {
    const { el, admin } = cell('credentials', ALICE, CTX, { counts: {}, replies: { credentials: () => json(404, { error_msg: 'Unsupported resource type' }) } });
    await waitFor(() => expect(el).toHaveTextContent(t('ui.empty')));
    expect(admin.requests.filter((r) => r.url.pathname.includes('/consumers/'))).toEqual([]);
  });

  it('updated, desc and labels sort and read as on the other lists', () => {
    expect(value('labels', ALICE)).toEqual(['org:acme']);
    expect(value('desc', BOB)).toBe('Internal tooling');
    const sorted = sortItems(CONSUMERS, [{ id: 'username', desc: true }], consumerColumns, CTX).map((i) => i.id);
    expect(sorted).toEqual(['carol', 'bob', 'alice']);
  });
});

describe('consumer filters', () => {
  const filter = (id: string) => {
    const f = consumerFilters.find((x) => x.id === id);
    if (!f) throw new Error(`no filter ${id}`);
    return f;
  };
  const pick = (selection: FilterSelection, ctx: Ctx = CTX) => applyFilters(CONSUMERS, '', consumerFilters, selection, ctx).map((i) => i.id);

  it('group: the groups in use by name, and "No group"', () => {
    expect(filter('group').options(CONSUMERS, CTX)).toEqual([
      { value: NO_GROUP, label: t('filter.noGroup') },
      { value: 'gone', label: 'gone' },
      { value: 'partners', label: 'Partners' },
    ]);
    expect(pick({ group: ['partners'] })).toEqual(['alice']);
    expect(pick({ group: [NO_GROUP] })).toEqual(['bob']);
  });

  it('plugin and label', () => {
    expect(filter('plugin').options(CONSUMERS, CTX).map((o) => o.value)).toEqual(['key-auth', 'limit-count']);
    expect(pick({ plugin: ['limit-count'] })).toEqual(['alice']);
    expect(pick({ label: ['org:beta'] })).toEqual(['carol']);
  });
});
