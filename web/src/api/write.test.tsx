import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAdmin, json, type FakeAdminOptions } from '../test/fakeAdmin';
import { getToasts } from '../ui/toast';
import { AdminClient } from './client';
import { ApiError } from './errors';
import { ClientProvider, queryKeys, scopedKey, useList } from './hooks';
import { resetReadOnlyKeys, useReadOnlyKey, useWrite } from './write';

afterEach(resetReadOnlyKeys);

const CONN = { id: 'c1', name: 'c1', baseUrl: 'http://apisix.test:9180', key: 'k' };

function setup(opts: FakeAdminOptions = {}, conn = CONN) {
  const admin = fakeAdmin(opts);
  const client = new AdminClient(conn, admin.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={client}>{children}</ClientProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => ({ write: useWrite(), readOnly: useReadOnlyKey(), routes: useList('routes') }), { wrapper });
  return { admin, result };
}

describe('useWrite', () => {
  it('returns the value, invalidates the listed kinds (refetching them) and toasts the success text', async () => {
    const { admin, result } = setup({ objects: { routes: [{ id: 'r1', status: 1 }] } });
    await waitFor(() => expect(result.current.routes.data).toHaveLength(1));
    const listCalls = () => admin.requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/routes')).length;
    const before = listCalls();

    let outcome: Awaited<ReturnType<ReturnType<typeof useWrite>>> | undefined;
    await act(async () => {
      outcome = await result.current.write((c) => c.patch('routes', 'r1', { status: 0 }), {
        invalidate: [{ kind: 'routes' }],
        success: 'Route disabled',
      });
    });
    expect(outcome).toMatchObject({ ok: true, value: { id: 'r1', value: { status: 0 } } });
    expect(listCalls()).toBe(before + 1);
    // The refetch has finished; observers hear about it a tick later.
    await waitFor(() => expect(result.current.routes.data?.[0]?.value.status).toBe(0));
    expect(getToasts().at(-1)).toMatchObject({ tone: 'success', message: 'Route disabled' });
  });

  it('never throws: an APISIX error comes back as { ok: false } with its message toasted', async () => {
    const { result } = setup({
      replies: { 'routes/r1': () => json(400, { error_msg: 'invalid configuration: property "uri" validation failed' }) },
    });
    let outcome: Awaited<ReturnType<ReturnType<typeof useWrite>>> | undefined;
    await act(async () => {
      outcome = await result.current.write((c) => c.replace('routes', 'r1', { uri: 5 }));
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.ok === false && outcome.error.status).toBe(400);
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: 'invalid configuration: property "uri" validation failed' });
    expect(result.current.readOnly).toBe(false);
  });

  it('wraps a thrown non-ApiError into an http ApiError', async () => {
    const { result } = setup();
    let outcome: Awaited<ReturnType<ReturnType<typeof useWrite>>> | undefined;
    await act(async () => {
      // Consumers have no PATCH: the client throws a plain Error before any request.
      outcome = await result.current.write((c) => c.patch('consumers', 'jo', { desc: 'x' }), { silent: true });
    });
    expect(outcome?.ok).toBe(false);
    if (outcome?.ok === false) {
      expect(outcome.error).toBeInstanceOf(ApiError);
      expect(outcome.error.kind).toBe('http');
      expect(outcome.error.message).toBe('APISIX has no PATCH for consumers');
    }
  });

  it('silent skips the error toast', async () => {
    const { result } = setup({ replies: { 'routes/r1': () => json(500, { error_msg: 'etcd down' }) } });
    const before = getToasts().length;
    await act(async () => {
      await result.current.write((c) => c.remove('routes', 'r1'), { silent: true });
    });
    expect(getToasts()).toHaveLength(before);
  });

  // That it does not navigate either is shown with the whole app, in ListPage.test.tsx.
  it('an auth failure marks this connection read-only, in memory', async () => {
    const { result } = setup({
      replies: { 'routes/r1': () => json(401, { error_msg: 'invalid method for role viewer' }) },
    });
    expect(result.current.readOnly).toBe(false);
    let outcome: Awaited<ReturnType<ReturnType<typeof useWrite>>> | undefined;
    await act(async () => {
      outcome = await result.current.write((c) => c.patch('routes', 'r1', { status: 0 }));
    });
    expect(outcome?.ok === false && outcome.error.kind).toBe('auth');
    expect(result.current.readOnly).toBe(true);
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: 'invalid method for role viewer' });

    // Another connection is not affected.
    const other = setup({}, { ...CONN, id: 'c2' });
    expect(other.result.current.readOnly).toBe(false);
  });
});

describe('useWrite forget', () => {
  it("drops the deleted object's cached item; deleting a consumer drops its credentials' too (APISIX removes them with it, admin/resource.lua 373–378)", async () => {
    const admin = fakeAdmin({ objects: { consumers: [{ username: 'jo' }] } });
    const client = new AdminClient(CONN, admin.fetch);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={client}>{children}</ClientProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useWrite(), { wrapper });
    const key = (k: unknown[]) => scopedKey(CONN.id, k);
    const cached = (k: unknown[]) => queryClient.getQueryData(key(k));
    queryClient.setQueryData(key(queryKeys.item('consumers', 'jo')), { id: 'jo', value: { username: 'jo' } });
    queryClient.setQueryData(key(queryKeys.item('credentials', 'c1', { consumer: 'jo' })), { id: 'c1', value: {} });
    queryClient.setQueryData(key(queryKeys.list('credentials', { consumer: 'jo' })), [{ id: 'c1', value: {} }]);
    queryClient.setQueryData(key(queryKeys.item('credentials', 'c1', { consumer: 'bob' })), { id: 'c1', value: {} });
    queryClient.setQueryData(key(queryKeys.item('routes', 'jo')), { id: 'jo', value: {} });
    await act(async () => {
      await result.current((c) => c.remove('consumers', 'jo'), { forget: [{ kind: 'consumers', id: 'jo' }] });
    });
    expect(cached(queryKeys.item('consumers', 'jo'))).toBeUndefined();
    expect(cached(queryKeys.item('credentials', 'c1', { consumer: 'jo' }))).toBeUndefined();
    expect(cached(queryKeys.list('credentials', { consumer: 'jo' }))).toBeUndefined();
    // Another consumer's credential and another kind's object of the same id stay.
    expect(cached(queryKeys.item('credentials', 'c1', { consumer: 'bob' }))).toBeDefined();
    expect(cached(queryKeys.item('routes', 'jo'))).toBeDefined();
  });
});
