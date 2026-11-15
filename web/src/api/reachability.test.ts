import { afterEach, describe, expect, it } from 'vitest';
import { AdminClient } from './client';
import { resetReachability, unreachableError } from './reachability';
import type { Connection } from './types';

// Fix round 1, R2: reachability is judged from real responses: a request with no answer raises it,
// any answer (an HTTP error included) clears it, and nothing written into the cache by the app counts.

afterEach(() => resetReachability());

const CONN: Connection = { id: 'r1', name: 'dev', baseUrl: 'http://apisix:9180', key: 'k' };

/** A client whose fetch answers with `status` (a JSON body), or not at all when `status` is 'network'. */
function clientAnswering(next: { status: number | 'network' }) {
  return new AdminClient(CONN, () => {
    if (next.status === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    const body = next.status === 200 ? { total: 0, list: [] } : { error_msg: 'nope' };
    return Promise.resolve(new Response(JSON.stringify(body), { status: next.status, headers: { 'Content-Type': 'application/json' } }));
  });
}

describe('reachability', () => {
  it('a 401, a 404 and a 500 are answers: they never raise it', async () => {
    const next: { status: number | 'network' } = { status: 401 };
    const client = clientAnswering(next);
    for (const status of [401, 404, 500]) {
      next.status = status;
      await expect(client.list('routes')).rejects.toBeTruthy();
      expect(unreachableError(CONN.id), String(status)).toBeUndefined();
    }
  });

  it('a request with no answer raises it; a later answer of any kind clears it', async () => {
    const next: { status: number | 'network' } = { status: 'network' };
    const client = clientAnswering(next);
    await expect(client.list('routes')).rejects.toThrow('Network error');
    expect(unreachableError(CONN.id)?.kind).toBe('network');
    // A write that gets no answer is as telling as a read.
    await expect(client.patch('routes', 'x', { status: 0 })).rejects.toThrow('Network error');
    expect(unreachableError(CONN.id)).toBeDefined();
    next.status = 500;
    await expect(client.list('routes')).rejects.toThrow('HTTP 500');
    expect(unreachableError(CONN.id)).toBeUndefined();
    next.status = 'network';
    await expect(client.list('upstreams')).rejects.toThrow('Network error');
    next.status = 200;
    await client.list('upstreams');
    expect(unreachableError(CONN.id)).toBeUndefined();
  });

  it('is kept per connection', async () => {
    await expect(clientAnswering({ status: 'network' }).list('routes')).rejects.toThrow();
    expect(unreachableError(CONN.id)).toBeDefined();
    expect(unreachableError('another')).toBeUndefined();
  });
});
