import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { createQueryClient } from './queryClient';

const auth = () => new ApiError('auth', 'HTTP 401: failed to check token', { status: 401, errorMsg: 'failed to check token' });

describe('createQueryClient', () => {
  it('retries only network failures, at most twice', () => {
    const qc = createQueryClient({ onQueryAuthError: () => {} });
    const retry = qc.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    const network = new ApiError('network', 'Network error: Failed to fetch');
    expect(retry(0, network)).toBe(true);
    expect(retry(1, network)).toBe(true);
    expect(retry(2, network)).toBe(false);
    expect(retry(0, auth())).toBe(false);
    expect(retry(0, new ApiError('http', 'HTTP 500', { status: 500 }))).toBe(false);
    expect(retry(0, new ApiError('parse', 'HTTP 502: not an APISIX Admin API response', { status: 502 }))).toBe(false);
    expect(retry(0, new Error('boom'))).toBe(false);
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(15_000);
  });

  it('reports a query auth error with the connection id from its key', async () => {
    const onQueryAuthError = vi.fn();
    const qc = createQueryClient({ onQueryAuthError });
    const error = auth();
    await qc.fetchQuery({ queryKey: ['conn-1', 'routes', null, 'list'], queryFn: () => Promise.reject(error) }).catch(() => {});
    expect(onQueryAuthError).toHaveBeenCalledExactlyOnceWith(error, 'conn-1');
  });

  it('ignores other query errors', async () => {
    const onQueryAuthError = vi.fn();
    const qc = createQueryClient({ onQueryAuthError });
    for (const error of [new ApiError('http', 'HTTP 404', { status: 404 }), new Error('boom')]) {
      await qc.fetchQuery({ queryKey: ['c', String(error.message)], queryFn: () => Promise.reject(error) }).catch(() => {});
    }
    expect(onQueryAuthError).not.toHaveBeenCalled();
  });

  it('never reports a mutation auth error (a viewer key writing): no redirect', async () => {
    const onQueryAuthError = vi.fn();
    const qc = createQueryClient({ onQueryAuthError });
    const viewer = new ApiError('auth', 'HTTP 401: invalid method for role viewer', { status: 401 });
    const mutation = qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(viewer) });
    await expect(mutation.execute(undefined)).rejects.toBe(viewer);
    expect(onQueryAuthError).not.toHaveBeenCalled();
  });
});
