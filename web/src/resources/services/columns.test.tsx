// The services list: its columns (the routes count takes routes and stream routes) and quick filters.
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { applyFilters, type FilterSelection } from '../../table/filter';
import { sortItems } from '../../table/sort';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { serviceColumns } from './columns';
import { serviceFilters } from './filters';

function col(id: string): ColumnDef {
  const column = serviceColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const WEB = itemOf('web', { name: 'web', desc: 'Public website', hosts: ['apiseven.test', 'www.apiseven.test'], upstream_id: 'web-pool', plugins: { gzip: {}, cors: { _meta: { disable: true } } }, labels: { team: 'web' }, enable_websocket: true });
const BILLING = itemOf('billing', { name: 'billing', upstream: { nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] }, plugins: { 'limit-req': {} } });
const BARE = itemOf('bare', { labels: { team: 'ops' } });
const SERVICES: Item[] = [WEB, BILLING, BARE];
const CTX = ctxOf({
  services: SERVICES,
  upstreams: [itemOf('web-pool', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
  routes: [itemOf('r1', { service_id: 'web' }), itemOf('r2', { service_id: 'web' }), itemOf('r3', { service_id: 'billing' }), itemOf('r4', {})],
  streamRoutes: [itemOf('sr1', { service_id: 'web' })],
});
const value = (id: string, item: Item, ctx: Ctx = CTX) => col(id).accessor(item, ctx);

function cell(id: string, item: Item, ctx: Ctx = CTX) {
  cleanup();
  renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return screen.getByTestId('cell');
}

describe('service columns', () => {
  it('lists the columns in order, the main ones visible by default, fitting a 1280px window', () => {
    expect(serviceColumns.map((c) => c.id)).toEqual(['name', 'hosts', 'upstream', 'plugins', 'routes', 'updated', 'id', 'desc', 'labels', 'websocket', 'created']);
    expect(serviceColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['name', 'hosts', 'upstream', 'plugins', 'routes', 'updated']);
    for (const column of serviceColumns) {
      expect(column.header, column.id).not.toMatch(/^column\./);
      expect(column.width, column.id).toBeGreaterThan(0);
    }
    // 1010px beside the sidebar, less the checkbox (34) and actions (40) columns.
    const widths = serviceColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0);
    expect(widths).toBeLessThanOrEqual(1010 - 34 - 40);
  });

  it('routes: how many routes and stream routes use the service, sorted as a number', () => {
    expect(value('routes', WEB)).toBe(3);
    expect(value('routes', BILLING)).toBe(1);
    expect(value('routes', BARE)).toBe(0);
    const sorted = sortItems(SERVICES, [{ id: 'routes', desc: true }], serviceColumns, CTX).map((i) => i.id);
    expect(sorted).toEqual(['web', 'billing', 'bare']);
    expect(cell('routes', WEB)).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: t('cell.usedBy', { count: 3 }) })).toBeInTheDocument();
  });

  it.each([
    ['routes', { routes: false }],
    ['stream routes', { streamRoutes: false }],
  ])('routes: "unused" when nothing uses it; "loading…" (no count) until the %s have loaded', (_, loaded) => {
    expect(cell('routes', BARE)).toHaveTextContent(t('cell.unused'));
    const loading = ctxOf({ ...CTX, loaded });
    expect(value('routes', WEB, loading)).toBeUndefined();
    expect(value('routes', BARE, loading)).toBeUndefined();
    expect(cell('routes', WEB, loading)).toHaveTextContent(t('picker.loading'));
    expect(cell('routes', BARE, loading)).not.toHaveTextContent(t('cell.unused'));
  });

  it('hosts, upstream and plugins: the service\'s own', () => {
    expect(value('hosts', WEB)).toEqual(['apiseven.test', 'www.apiseven.test']);
    expect(cell('hosts', BARE)).toHaveTextContent(t('cell.anyHost'));
    expect(value('upstream', WEB)).toBe('web-pool');
    expect(cell('upstream', BILLING)).toHaveTextContent('10.0.1.20:3000');
    expect(value('upstream', BARE)).toBeUndefined();
    expect(value('plugins', WEB)).toEqual(['cors', 'gzip']);
    expect(cell('plugins', WEB)).toHaveTextContent(t('cell.plugin.off'));
  });

  it('the optional columns: id, description, labels, WebSocket, created', () => {
    expect(value('id', WEB)).toBe('web');
    expect(value('desc', WEB)).toBe('Public website');
    expect(value('labels', WEB)).toEqual(['team:web']);
    expect(value('websocket', WEB)).toBe(true);
    expect(value('websocket', BILLING)).toBe(false);
  });
});

const filter = (id: string) => {
  const def = serviceFilters.find((f) => f.id === id);
  if (!def) throw new Error(`no filter ${id}`);
  return def;
};
const names = (selection: FilterSelection, ctx: Ctx = CTX) => applyFilters(SERVICES, '', serviceFilters, selection, ctx).map((i) => i.id);

describe('serviceFilters', () => {
  it('offers plugin, usage and label chips', () => {
    expect(serviceFilters.map((f) => f.id)).toEqual(['plugin', 'unused', 'label']);
  });

  it('plugin: the plugins the services hold', () => {
    expect(filter('plugin').options(SERVICES, CTX).map((o) => o.value)).toEqual(['cors', 'gzip', 'limit-req']);
    expect(names({ plugin: ['limit-req'] })).toEqual(['billing']);
  });

  it('unused: no route and no stream route uses it', () => {
    expect(names({ unused: ['unused'] })).toEqual(['bare']);
    expect(names({ unused: ['used'] })).toEqual(['web', 'billing']);
    // A service only a stream route uses is in use.
    const onlyStream = ctxOf({ services: SERVICES, streamRoutes: [itemOf('sr1', { service_id: 'bare' })] });
    expect(names({ unused: ['unused'] }, onlyStream)).toEqual(['web', 'billing']);
  });

  it.each([
    ['routes', { routes: false }],
    ['stream routes', { streamRoutes: false }],
  ])('unused: matches nothing either way until the %s have loaded (fix round 1)', (_, loaded) => {
    const loading = ctxOf({ ...CTX, loaded });
    expect(names({ unused: ['unused'] }, loading)).toEqual([]);
    expect(names({ unused: ['used'] }, loading)).toEqual([]);
  });

  it('label: key:value pairs in use', () => {
    expect(filter('label').options(SERVICES, CTX).map((o) => o.value)).toEqual(['team:ops', 'team:web']);
    expect(names({ label: ['team:ops'] })).toEqual(['bare']);
  });
});
