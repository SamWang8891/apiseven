// Final wave K2: the bulk Delete confirmation reads what uses the selected objects from one reverse index
// per context, built once for a render however many objects are selected, and shows what the single
// Delete dialog shows for each.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../api/types';
import { referenceIndex, referenceUse } from '../resources/resolve';
import { ctxOf, itemOf } from '../test/ctx';
import { renderWithProviders } from '../test/providers';
import { BulkReferences } from './BulkReferences';

vi.mock('../resources/resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../resources/resolve')>();
  return { ...actual, referenceIndex: vi.fn(actual.referenceIndex), referenceUse: vi.fn(actual.referenceUse) };
});

afterEach(() => {
  vi.mocked(referenceIndex).mockClear();
  vi.mocked(referenceUse).mockClear();
});

const ctx = ctxOf({
  routes: [itemOf('r1', { name: 'alpha', upstream_id: 'u1' }), itemOf('r2', { name: 'beta', upstream_id: 'u1' }), itemOf('r3', { name: 'gamma', upstream_id: 'u9' })],
  services: [itemOf('s1', { name: 'billing', upstream_id: 'u2' })],
});
const pools: Item[] = [itemOf('u1', { name: 'pool-1' }), itemOf('u2', { name: 'pool-2' }), itemOf('u3', { name: 'pool-3' })];

/** The names each object's group lists, by the group's name. */
function listed(): Record<string, string[]> {
  const entries = screen.getAllByRole('group').map((group): [string, string[]] => [group.getAttribute('aria-label') ?? '', within(group).getAllByRole('link').map((a) => a.textContent ?? '')]);
  return Object.fromEntries(entries);
}

describe('BulkReferences', () => {
  it('shows, for several selected objects, what uses each (as the single dialog does), and none for an unused one', async () => {
    renderWithProviders(<BulkReferences kind="upstreams" items={pools} ctx={ctx} />);
    await screen.findAllByRole('group');
    expect(listed()).toEqual({
      'pool-1': ['Route alpha', 'Route beta'],
      'pool-2': ['Service billing'],
    });
  });

  it('builds the index once per context for a render, not once per selected object', async () => {
    const one = renderWithProviders(<BulkReferences kind="upstreams" items={pools.slice(0, 1)} ctx={ctx} />);
    await screen.findAllByRole('group');
    const forOne = vi.mocked(referenceIndex).mock.calls.length;
    one.unmount();
    vi.mocked(referenceIndex).mockClear();
    renderWithProviders(<BulkReferences kind="upstreams" items={pools} ctx={ctx} />);
    await screen.findAllByRole('group');
    const forThree = vi.mocked(referenceIndex).mock.calls.length;
    expect(forOne).toBeGreaterThan(0);
    expect(forThree).toBe(forOne);
    // References uses what the dialog read: it never falls back to a call of its own per object.
    expect(vi.mocked(referenceUse)).not.toHaveBeenCalled();
    for (const [kind, given] of vi.mocked(referenceIndex).mock.calls) {
      expect(kind).toBe('upstreams');
      expect(given).toBe(ctx);
    }
  });
});

describe('BulkReferences, protos (F4)', () => {
  const protoCtx = ctxOf({
    routes: [itemOf('r1', { name: 'alpha', plugins: { 'grpc-transcode': { proto_id: 'p1' } } })],
    services: [itemOf('s1', { name: 'billing', plugins: { 'grpc-transcode': { proto_id: 'p1' } } })],
    pluginConfigs: [itemOf('pc1', { name: 'shared', plugins: { 'grpc-transcode': { proto_id: 'p2' } } })],
  });
  const protos: Item[] = [itemOf('p1', { name: 'greeter' }), itemOf('p2', { name: 'other' }), itemOf('p3', { name: 'unused' })];

  it('shows what uses each selected proto, as the single dialog does, from the one index: References computes nothing of its own', async () => {
    renderWithProviders(<BulkReferences kind="protos" items={protos} ctx={protoCtx} />);
    await screen.findAllByRole('group');
    expect(listed()).toEqual({ greeter: ['Route alpha', 'Service billing'], other: ['Plugin Config shared'] });
    expect(vi.mocked(referenceUse)).not.toHaveBeenCalled();
    expect(vi.mocked(referenceIndex).mock.calls.every(([kind, given]) => kind === 'protos' && given === protoCtx)).toBe(true);
  });
});
