import { describe, expect, it } from 'vitest';
import { loadServerConfig, serverBaseUrl } from './bootstrap';

function fetchReturning(make: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return Promise.resolve(make());
  };
  return { fetchImpl, calls };
}

describe('loadServerConfig', () => {
  it('reads config.json next to the page, sending same-origin credentials', async () => {
    const { fetchImpl, calls } = fetchReturning(
      () => new Response('{"adminBase":"/apisix/admin","keyRequired":true}', { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(loadServerConfig(fetchImpl)).resolves.toEqual({ adminBase: '/apisix/admin', keyRequired: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(new URL('config.json', document.baseURI).href);
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  it('is undefined on 404', async () => {
    const { fetchImpl } = fetchReturning(() => new Response('Not Found', { status: 404 }));
    await expect(loadServerConfig(fetchImpl)).resolves.toBeUndefined();
  });

  it("is undefined for an HTML 200 (a dev server's SPA fallback)", async () => {
    const { fetchImpl } = fetchReturning(
      () => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(loadServerConfig(fetchImpl)).resolves.toBeUndefined();
  });

  it('is undefined for JSON of the wrong shape', async () => {
    for (const body of ['{"adminBase":"/apisix/admin"}', '{"adminBase":1,"keyRequired":false}', '[]', 'null', '"x"']) {
      const { fetchImpl } = fetchReturning(() => new Response(body));
      await expect(loadServerConfig(fetchImpl), body).resolves.toBeUndefined();
    }
  });

  it('is undefined when the request fails', async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(loadServerConfig(fetchImpl)).resolves.toBeUndefined();
  });
});

describe('serverBaseUrl', () => {
  it('resolves adminBase against the page and drops the trailing /apisix/admin', () => {
    const origin = new URL(document.baseURI).origin;
    expect(serverBaseUrl({ adminBase: '/apisix/admin', keyRequired: false })).toBe(origin);
    expect(serverBaseUrl({ adminBase: '/apisix/admin/', keyRequired: false })).toBe(origin);
    expect(serverBaseUrl({ adminBase: '/proxy/apisix/admin', keyRequired: false })).toBe(`${origin}/proxy`);
    expect(serverBaseUrl({ adminBase: 'http://other:9180/apisix/admin', keyRequired: false })).toBe('http://other:9180');
  });
});
