import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ClientProvider, queryKeys, scopedKey } from '../api/hooks';
import type { Item } from '../api/types';
import { itemOf } from '../test/ctx';
import { fakeAdmin, json, type FakeAdminOptions } from '../test/fakeAdmin';
import { useCtx, type Ctx } from './ctx';

const queryClients: QueryClient[] = [];

afterEach(() => {
  for (const qc of queryClients.splice(0)) qc.clear();
});

function setup(opts: FakeAdminOptions = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(qc);
  const admin = fakeAdmin(opts);
  const client = new AdminClient({ id: 'c1', name: 'c1', baseUrl: 'http://apisix.test:9180' }, admin.fetch);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ClientProvider client={client}>{children}</ClientProvider>
    </QueryClientProvider>
  );
  return { qc, admin, ...renderHook(() => useCtx(), { wrapper }) };
}

const COUNTS = {
  routes: 3,
  stream_routes: 1,
  services: 2,
  upstreams: 2,
  ssls: 1,
  plugin_configs: 1,
  consumer_groups: 1,
  consumers: 2,
};

function sizes(ctx: Ctx): Record<string, number> {
  const lists = Object.entries(ctx).filter((entry): entry is [string, Item[]] => entry[0] !== 'loaded');
  return Object.fromEntries(lists.map(([k, v]) => [k, v.length]));
}

const NOTHING_LOADED = {
  routes: false, streamRoutes: false, services: false, upstreams: false, ssls: false, pluginConfigs: false, consumerGroups: false, consumers: false,
};

describe('useCtx', () => {
  it('has empty lists while loading', () => {
    const { result } = setup({ counts: COUNTS });
    expect(sizes(result.current)).toEqual({
      routes: 0, streamRoutes: 0, services: 0, upstreams: 0, ssls: 0, pluginConfigs: 0, consumerGroups: 0, consumers: 0,
    });
    expect(result.current.loaded).toEqual(NOTHING_LOADED);
  });

  it('marks each list loaded once its query has succeeded, an empty list too', async () => {
    const { result } = setup({ counts: { ...COUNTS, ssls: 0 } });
    await waitFor(() => expect(Object.values(result.current.loaded).every(Boolean)).toBe(true));
    expect(result.current.ssls).toEqual([]);
    expect(result.current.loaded.ssls).toBe(true);
  });

  it('reads the eight lists into their fields', async () => {
    const { result } = setup({ counts: COUNTS });
    await waitFor(() =>
      expect(sizes(result.current)).toEqual({
        routes: 3, streamRoutes: 1, services: 2, upstreams: 2, ssls: 1, pluginConfigs: 1, consumerGroups: 1, consumers: 2,
      }),
    );
    expect(result.current.streamRoutes[0]?.id).toBe('stream_routes-1');
    expect(result.current.pluginConfigs[0]?.id).toBe('plugin_configs-1');
    expect(result.current.consumerGroups[0]?.id).toBe('consumer_groups-1');
  });

  it('gives an empty list for a list that failed', async () => {
    const { result, admin } = setup({
      counts: COUNTS,
      replies: { stream_routes: () => json(400, { error_msg: 'stream mode is disabled' }) },
    });
    await waitFor(() => expect(result.current.routes).toHaveLength(3));
    await waitFor(() => expect(admin.requests.some((r) => r.url.pathname.endsWith('/stream_routes'))).toBe(true));
    expect(result.current.streamRoutes).toEqual([]);
    // Never loaded: a reference into it can't be called dangling.
    expect(result.current.loaded.streamRoutes).toBe(false);
    expect(result.current.loaded.routes).toBe(true);
  });

  it('keeps the same object across re-renders and same-data refetches', async () => {
    const { result, rerender, qc } = setup({ counts: COUNTS });
    await waitFor(() => expect(sizes(result.current).consumers).toBe(2));
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    const before = result.current;

    rerender();
    expect(result.current).toBe(before);
    expect(result.current.loaded).toBe(before.loaded);

    await act(() => qc.invalidateQueries());
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(result.current).toBe(before);
  });

  it('gives a new object when a list changes, keeping the unchanged lists', async () => {
    const { result, qc } = setup({ counts: COUNTS });
    await waitFor(() => expect(sizes(result.current).consumers).toBe(2));
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    const before = result.current;

    act(() => {
      qc.setQueryData(scopedKey('c1', queryKeys.list('routes')), [itemOf('new-route')]);
    });
    await waitFor(() => expect(result.current.routes.map((r) => r.id)).toEqual(['new-route']));
    expect(result.current).not.toBe(before);
    expect(result.current.services).toBe(before.services);
    expect(result.current.consumers).toBe(before.consumers);
  });
});
