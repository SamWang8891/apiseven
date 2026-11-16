// The stream routes list columns.
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { sortItems } from '../../table/sort';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { streamRouteColumns } from './columns';

function col(id: string): ColumnDef {
  const column = streamRouteColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const ETCD = itemOf('etcd-tcp', { name: 'etcd-tcp', desc: 'TCP 9100 to etcd', server_port: 9100, plugins: { 'limit-conn': {} }, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] }, labels: { env: 'dev' } });
const TLS = itemOf('sr2', { server_addr: '127.0.0.1', server_port: 9443, snis: ['a.example', 'b.example'], remote_addr: '10.0.0.0/8', service_id: 'web' });
const BARE = itemOf('sr3', { sni: 'c.example', server_port: 80, upstream_id: 'web-pool' });
const ITEMS = [ETCD, TLS, BARE];
const CTX = ctxOf({
  streamRoutes: ITEMS,
  services: [itemOf('web', { name: 'web', upstream_id: 'web-pool', plugins: { 'ip-restriction': {} } })],
  upstreams: [itemOf('web-pool', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
});
const value = (id: string, item: Item, ctx: Ctx = CTX) => col(id).accessor(item, ctx);

function cell(id: string, item: Item, ctx: Ctx = CTX) {
  cleanup();
  renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return screen.getByTestId('cell');
}

describe('stream route columns', () => {
  it('lists the columns in order, the main ones visible by default, fitting a 1280px window', () => {
    expect(streamRouteColumns.map((c) => c.id)).toEqual(['name', 'server_addr', 'server_port', 'sni', 'remote_addr', 'upstream', 'plugins', 'updated', 'id', 'desc', 'service', 'labels', 'created']);
    expect(streamRouteColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['name', 'server_addr', 'server_port', 'sni', 'remote_addr', 'upstream', 'plugins', 'updated']);
    for (const column of streamRouteColumns) {
      expect(column.header, column.id).not.toMatch(/^column\./);
      expect(column.width, column.id).toBeGreaterThan(0);
    }
    const widths = streamRouteColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0);
    expect(widths).toBeLessThanOrEqual(1010 - 34 - 40);
  });

  it('name: the name, else the id', () => {
    expect(value('name', ETCD)).toBe('etcd-tcp');
    expect(value('name', BARE)).toBe('sr3');
  });

  it('the matching fields, addresses and SNIs in mono; the port sorts as a number', () => {
    expect(value('server_addr', TLS)).toBe('127.0.0.1');
    expect(value('server_addr', ETCD)).toBeUndefined();
    expect(value('server_port', ETCD)).toBe(9100);
    expect(sortItems(ITEMS, [{ id: 'server_port', desc: false }], streamRouteColumns, CTX).map((i) => i.id)).toEqual(['sr3', 'etcd-tcp', 'sr2']);
    expect(value('sni', TLS)).toEqual(['a.example', 'b.example']);
    expect(value('sni', BARE)).toEqual(['c.example']);
    expect(value('remote_addr', TLS)).toBe('10.0.0.0/8');
    for (const id of ['server_addr', 'sni', 'remote_addr']) expect(col(id).mono, id).toBe(true);
    expect(cell('sni', TLS)).toHaveTextContent('a.exampleb.example');
    expect(cell('sni', ETCD)).toHaveTextContent(t('ui.empty'));
  });

  it('upstream: its own, an upstream object, or the service\'s', () => {
    expect(cell('upstream', ETCD)).toHaveTextContent('etcd:2379');
    expect(value('upstream', BARE)).toBe('web-pool');
    expect(value('upstream', TLS)).toBe('web');
    expect(cell('upstream', TLS)).toHaveTextContent(t('cell.viaService'));
  });

  it('plugins: its own, and the service\'s it inherits', () => {
    expect(value('plugins', ETCD)).toEqual(['limit-conn']);
    expect(value('plugins', TLS)).toEqual(['ip-restriction']);
    expect(cell('plugins', TLS)).toHaveTextContent(t('cell.plugin.fromService', { name: 'web' }));
  });

  it('plugins: a service\'s http plugins are not listed or sorted on, they can\'t run on a stream route (Ruling 3)', () => {
    const ctx = ctxOf({ ...CTX, services: [itemOf('web', { name: 'web', plugins: { 'limit-count': {}, 'limit-conn': {}, 'my-custom': {} } })] });
    expect(value('plugins', TLS, ctx)).toEqual(['limit-conn', 'my-custom']);
    const shown = cell('plugins', TLS, ctx);
    expect(shown).toHaveTextContent('limit-conn');
    expect(shown).not.toHaveTextContent('limit-count');
  });

  // Fix round 1, F1: the stream subsystem merges only plugins and upstream from a service and loads no
  // script (apisix/plugin.lua 775–802; init.lua 1064–1067 is the HTTP access phase): its plugins run.
  it("plugins: a service's script changes nothing for a stream route, whose plugins read as running", () => {
    const ctx = ctxOf({ ...CTX, services: [itemOf('web', { name: 'web', script: 'return {} -- service', plugins: { 'ip-restriction': {} } })] });
    const route = itemOf('sr9', { server_port: 9100, service_id: 'web', plugins: { 'limit-conn': {} } });
    const shown = cell('plugins', route, ctx);
    expect(shown).toHaveTextContent('limit-conn');
    expect(shown).toHaveTextContent('ip-restriction');
    expect(shown).not.toHaveTextContent(t('cell.plugin.notRun'));
    expect(shown.querySelectorAll('.cell-plugin--off')).toHaveLength(0);
  });

  it('the optional columns: id, description, service, labels', () => {
    expect(value('id', ETCD)).toBe('etcd-tcp');
    expect(value('desc', ETCD)).toBe('TCP 9100 to etcd');
    expect(value('service', TLS)).toBe('web');
    expect(value('labels', ETCD)).toEqual(['env:dev']);
  });
});
