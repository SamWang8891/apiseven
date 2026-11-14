import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { sortItems } from '../../table/sort';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { upstreamColumns } from './columns';

function col(id: string): ColumnDef {
  const column = upstreamColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const POOL = itemOf('u1', {
  name: 'web-pool',
  desc: 'Web frontends',
  type: 'roundrobin',
  nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }, { host: '10.0.0.12', port: 8080, weight: 1 }],
  retries: 1,
  checks: { active: {}, passive: {} },
  labels: { team: 'web' },
});
const API = itemOf('u2', { type: 'chash', hash_on: 'header', key: 'x-user-id', scheme: 'https', nodes: { 'backend.internal:443': 10 }, pass_host: 'node', checks: { active: {} } });
const DISCO = itemOf('u3', { discovery_type: 'consul', service_name: 'billing' });
const CTX = ctxOf({
  upstreams: [POOL, API, DISCO],
  routes: [itemOf('r1', { name: 'shop', upstream_id: 'u1' }), itemOf('r2', { upstream_id: 'u1' }), itemOf('r3', { name: 'api', upstream_id: 'u2' })],
  services: [itemOf('s1', { name: 'web', upstream_id: 'u1' })],
});
const value = (id: string, item: Item, ctx: Ctx = CTX) => col(id).accessor(item, ctx);

function cell(id: string, item: Item, ctx: Ctx = CTX) {
  renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return screen.getByTestId('cell');
}

describe('upstream columns', () => {
  it('lists the columns in order, the main ones visible by default', () => {
    expect(upstreamColumns.map((c) => c.id)).toEqual(['name', 'type', 'nodes', 'scheme', 'used_by', 'updated', 'id', 'desc', 'retries', 'health', 'pass_host', 'labels', 'created']);
    expect(upstreamColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['name', 'type', 'nodes', 'scheme', 'used_by', 'updated']);
    for (const column of upstreamColumns) {
      expect(column.header, column.id).not.toMatch(/^column\./);
      expect(column.width, column.id).toBeGreaterThan(0);
    }
    // Default columns fit the 1010px a 1280px window leaves (checkbox 34 + actions 40).
    const widths = upstreamColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0);
    expect(widths + 34 + 40).toBeLessThanOrEqual(1010);
  });

  it('type: the algorithm, with what chash hashes on', () => {
    expect(value('type', POOL)).toBe('roundrobin');
    expect(value('type', DISCO)).toBe('roundrobin');
    expect(cell('type', API)).toHaveTextContent(`${t('up.balance.chash')}header x-user-id`);
  });

  it('nodes: the addresses, or the discovery service', () => {
    expect(value('nodes', POOL)).toEqual(['10.0.0.11:8080', '10.0.0.12:8080']);
    expect(value('nodes', API)).toEqual(['backend.internal:443']);
    expect(value('nodes', DISCO)).toEqual(['consul: billing']);
    expect(cell('nodes', POOL)).toHaveTextContent('10.0.0.11:808010.0.0.12:8080');
  });

  it('scheme: the scheme, http when unset', () => {
    expect(value('scheme', POOL)).toBe('http');
    expect(value('scheme', API)).toBe('https');
  });

  it('used_by: how many objects point at the upstream, sortable as a number, the first in a tooltip', async () => {
    expect(value('used_by', POOL)).toBe(3);
    expect(value('used_by', API)).toBe(1);
    expect(value('used_by', DISCO)).toBe(0);
    const sorted = sortItems([POOL, API, DISCO], [{ id: 'used_by', desc: false }], upstreamColumns, CTX);
    expect(sorted.map((i) => i.id)).toEqual(['u3', 'u2', 'u1']);

    const user = userEvent.setup();
    const el = cell('used_by', POOL);
    const count = within(el).getByRole('button', { name: t('cell.usedBy', { count: 3 }) });
    await user.hover(count);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(`${t('kind.routes.singular')} r2`);
    expect(tip).toHaveTextContent(`${t('kind.routes.singular')} shop`);
    expect(tip).toHaveTextContent(`${t('kind.services.singular')} web`);
    cleanup();
    expect(cell('used_by', DISCO)).toHaveTextContent(t('cell.unused'));
  });

  it('health: Active, Active + passive or Off', () => {
    expect(value('health', POOL)).toBe(t('up.health.both'));
    expect(value('health', API)).toBe(t('up.health.active'));
    expect(value('health', DISCO)).toBe(t('ui.off'));
  });

  it('the optional columns read their fields', () => {
    expect(value('retries', POOL)).toBe(1);
    expect(value('pass_host', API)).toBe('node');
    expect(value('labels', POOL)).toEqual(['team:web']);
    expect(value('desc', POOL)).toBe('Web frontends');
  });
});
