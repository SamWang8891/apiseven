import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminClient } from './client';
import {
  ClientProvider,
  queryKeys,
  scopedKey,
  useAllPlugins,
  useClient,
  useInvalidate,
  useItem,
  useList,
  useResourceSchema,
} from './hooks';

const queryClients: QueryClient[] = [];

function newQueryClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(qc);
  return qc;
}

afterEach(() => {
  for (const qc of queryClients.splice(0)) qc.clear();
});

/** A real AdminClient whose fetch answers from `routes` by URL path and counts requests. */
function fakeClient(connId: string, routes: Record<string, unknown>) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const path = new URL(url, 'http://x').pathname.replace('/apisix/admin/', '');
    const body = routes[path];
    return Promise.resolve(
      body === undefined
        ? new Response('{"message":"Key not found"}', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  };
  return { client: new AdminClient({ id: connId, name: connId, baseUrl: '' }, fetchImpl), urls };
}

function wrapper(client: AdminClient, qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ClientProvider client={client}>{children}</ClientProvider>
      </QueryClientProvider>
    );
  };
}

const routeList = (id: string) => ({ total: 1, list: [{ key: `/apisix/routes/${id}`, value: { id } }] });

describe('useClient', () => {
  it('returns the provided client', () => {
    const { client } = fakeClient('c1', {});
    const { result } = renderHook(() => useClient(), { wrapper: wrapper(client, newQueryClient()) });
    expect(result.current).toBe(client);
  });

  it('throws a clear error without a ClientProvider', () => {
    expect(() => renderHook(() => useClient())).toThrow(/ClientProvider/);
  });
});

describe('useList', () => {
  it('loads the list and caches it under the connection id', async () => {
    const qc = newQueryClient();
    const { client } = fakeClient('c1', { routes: routeList('r1') });
    const { result } = renderHook(() => useList('routes'), { wrapper: wrapper(client, qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((i) => i.id)).toEqual(['r1']);
    expect(qc.getQueryData(scopedKey('c1', queryKeys.list('routes')))).toEqual(result.current.data);
  });

  it('never serves one connection\'s cache to another', async () => {
    const qc = newQueryClient();
    const one = fakeClient('c1', { routes: routeList('from-c1') });
    const two = fakeClient('c2', { routes: routeList('from-c2') });
    const first = renderHook(() => useList('routes'), { wrapper: wrapper(one.client, qc) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useList('routes'), { wrapper: wrapper(two.client, qc) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(first.result.current.data?.[0]?.id).toBe('from-c1');
    expect(second.result.current.data?.[0]?.id).toBe('from-c2');
    expect(two.urls).toHaveLength(1);
  });

  it('keys credentials by their consumer', async () => {
    const qc = newQueryClient();
    const { client } = fakeClient('c1', {
      'consumers/alice/credentials': { total: 1, list: [{ key: '/apisix/consumers/alice/credentials/k', value: { id: 'k' } }] },
    });
    const { result } = renderHook(() => useList('credentials', { consumer: 'alice' }), { wrapper: wrapper(client, qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(scopedKey('c1', queryKeys.list('credentials', { consumer: 'alice' })))).toHaveLength(1);
    expect(qc.getQueryData(scopedKey('c1', queryKeys.list('credentials', { consumer: 'bob' })))).toBeUndefined();
  });

  it('exposes the ApiError on failure', async () => {
    const { client } = fakeClient('c1', {});
    const { result } = renderHook(() => useList('routes'), { wrapper: wrapper(client, newQueryClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe('http');
    expect(result.current.error?.status).toBe(404);
  });
});

describe('useItem', () => {
  it('loads one item', async () => {
    const { client } = fakeClient('c1', { 'routes/r1': { key: '/apisix/routes/r1', value: { id: 'r1', uri: '/' } } });
    const { result } = renderHook(() => useItem('routes', 'r1'), { wrapper: wrapper(client, newQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'r1', value: { id: 'r1', uri: '/' } });
  });

  it('stays idle without an id', () => {
    const { client, urls } = fakeClient('c1', {});
    const { result } = renderHook(() => useItem('routes', undefined), { wrapper: wrapper(client, newQueryClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(urls).toEqual([]);
  });
});

describe('useAllPlugins', () => {
  it('loads plugins?all=true', async () => {
    const all = { 'limit-count': { schema: { type: 'object' } } };
    const { client } = fakeClient('c1', { plugins: all });
    const { result } = renderHook(() => useAllPlugins(), { wrapper: wrapper(client, newQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(all);
  });

  it("loads the stream set with 'stream', under its own key", async () => {
    const { client, urls } = fakeClient('c1', { plugins: { 'limit-conn': { schema: {} } } });
    const qc = newQueryClient();
    const { result } = renderHook(() => ({ http: useAllPlugins(), stream: useAllPlugins('stream') }), { wrapper: wrapper(client, qc) });
    await waitFor(() => expect(result.current.stream.isSuccess && result.current.http.isSuccess).toBe(true));
    expect(urls.map((u) => new URL(u, 'http://x').search).sort()).toEqual(['?all=true', '?all=true&subsystem=stream']);
  });
});

describe('useResourceSchema', () => {
  it('loads schema/<name>', async () => {
    const schema = { type: 'object', properties: { nodes: {} } };
    const { client, urls } = fakeClient('c1', { 'schema/upstream': schema });
    const { result } = renderHook(() => useResourceSchema('upstream'), { wrapper: wrapper(client, newQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(schema);
    expect(urls).toEqual(['/apisix/admin/schema/upstream']);
  });
});

describe('useInvalidate', () => {
  it('invalidates one kind\'s lists and items for the active connection only', async () => {
    const qc = newQueryClient();
    const keys = {
      routes: scopedKey('c1', queryKeys.list('routes')),
      route: scopedKey('c1', queryKeys.item('routes', 'r1')),
      services: scopedKey('c1', queryKeys.list('services')),
      otherConn: scopedKey('c2', queryKeys.list('routes')),
      aliceCreds: scopedKey('c1', queryKeys.list('credentials', { consumer: 'alice' })),
      aliceCred: scopedKey('c1', queryKeys.item('credentials', 'k', { consumer: 'alice' })),
      bobCreds: scopedKey('c1', queryKeys.list('credentials', { consumer: 'bob' })),
    };
    for (const key of Object.values(keys)) qc.setQueryData(key, []);
    const { client } = fakeClient('c1', {});
    const { result } = renderHook(() => useInvalidate(), { wrapper: wrapper(client, qc) });

    await act(() => result.current('routes'));
    await act(() => result.current('credentials', { consumer: 'alice' }));

    const invalidated = Object.entries(keys)
      .filter(([, key]) => qc.getQueryState(key)?.isInvalidated)
      .map(([name]) => name);
    expect(invalidated).toEqual(['routes', 'route', 'aliceCreds', 'aliceCred']);
  });

  it('makes a mounted list refetch', async () => {
    let n = 0;
    const qc = newQueryClient();
    const client = new AdminClient({ id: 'c1', name: 'c1', baseUrl: '' }, () =>
      Promise.resolve(new Response(JSON.stringify(routeList(`r${++n}`)), { status: 200 })),
    );
    const { result } = renderHook(() => ({ list: useList('routes'), invalidate: useInvalidate() }), {
      wrapper: wrapper(client, qc),
    });
    await waitFor(() => expect(result.current.list.data?.[0]?.id).toBe('r1'));
    await act(() => result.current.invalidate('routes'));
    await waitFor(() => expect(result.current.list.data?.[0]?.id).toBe('r2'));
  });
});
