// @vitest-environment node
// Without a page at all (Node, as in the *.live.test.ts files): nothing is the page's origin.
import { describe, expect, it } from 'vitest';
import { AdminClient } from './client';
import { isPageOrigin } from './origin';

describe('isPageOrigin without a document', () => {
  it('is false, and an AdminClient still builds and sends neither the proxy header nor credentials', async () => {
    expect(isPageOrigin('')).toBe(false);
    expect(isPageOrigin('http://127.0.0.1:9180')).toBe(false);
    const calls: RequestInit[] = [];
    const api = new AdminClient({ id: 'c', name: 'c', baseUrl: 'http://127.0.0.1:9180' }, (_input, init) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response(JSON.stringify({ total: 0, list: [] }), { headers: { 'Content-Type': 'application/json' } }));
    });
    await api.list('routes');
    expect(new Headers(calls[0]?.headers).has('X-Apiseven-Request')).toBe(false);
    expect(calls[0]?.credentials).toBe('omit');
  });
});
