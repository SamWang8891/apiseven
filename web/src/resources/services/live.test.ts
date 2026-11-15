// @vitest-environment node
// A service and a route in it, as the editors write them, saved to a real APISIX (dev/compose.yaml)
// and requested through its gateway; skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/resources/services/live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key),
// APISIX_GATEWAY_URL (default http://127.0.0.1:9080). The service's inline upstream is the dev etcd
// (etcd:2379 inside the compose network), whose /version answers JSON. It creates one service, one
// route, one upstream and one stream route named after `tag`, and removes them.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../../api/client';
import type { Item, Obj } from '../../api/types';
import { saveResource, type SaveResult } from '../../editor/save';
import { ctxOf } from '../../test/ctx';
import { routeIssues } from '../routes/validate';
import { streamRouteIssues } from '../stream_routes/validate';
import { serviceIssues } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const gateway = env.APISIX_GATEWAY_URL ?? 'http://127.0.0.1:9080';
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];
const check = { isNew: true, ctx: ctxOf({ loaded: { services: false, upstreams: false } }) };

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : 'exists' in result ? 'an existing object' : 'unchecked' in result ? result.unchecked.message : result.error.message}`);
  return result.item;
}

/** The gateway's answer once APISIX has picked the route up from etcd (a moment after the write). */
async function untilRouted(url: string, init: RequestInit, done: (res: Response) => boolean): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 0; i < 40 && !done(res); i++) {
    await new Promise((r) => setTimeout(r, 250));
    res = await fetch(url, init);
  }
  return res;
}

describe.skipIf(env.APISIX_LIVE !== '1')('a service and what uses it, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('a route in a service resolves to the service\'s upstream at the gateway, and runs its plugins', async () => {
    const service: Obj = { name: tag, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] }, plugins: { cors: {} } };
    expect(serviceIssues(service, check)).toEqual([]);
    const s = saved(await saveResource(api, { kind: 'services', isNew: true, draft: service }));
    undo.push(() => api.remove('services', s.id));

    // What "New route in this service" starts with (prefill service_id), plus where it matches.
    const route: Obj = { uri: '/version', service_id: s.id, vars: [['arg_live', '==', tag]], status: 1 };
    expect(routeIssues(route, check)).toEqual([]);
    const r = saved(await saveResource(api, { kind: 'routes', isNew: true, draft: route }));
    undo.push(() => api.remove('routes', r.id));
    expect(r.value).not.toHaveProperty('upstream');
    expect(r.value).not.toHaveProperty('upstream_id');

    const url = `${gateway}/version?live=${tag}`;
    const res = await untilRouted(url, { headers: { Origin: 'https://example.org' } }, (x) => x.status !== 404);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('etcdserver');
    // The service's cors plugin ran for the route.
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    await api.remove('routes', r.id);
    expect((await untilRouted(url, {}, (x) => x.status === 404)).status).toBe(404);
  });

  it('a stream route on port 9100 with an upstream_id is listed by the Admin API', async () => {
    const up = saved(await saveResource(api, { kind: 'upstreams', isNew: true, draft: { name: tag, nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } }));
    undo.push(() => api.remove('upstreams', up.id));
    // A client address no dev connection has, so the seeded etcd-tcp route keeps the port's traffic.
    const draft: Obj = { name: tag, server_port: 9100, remote_addr: '192.0.2.1', upstream_id: up.id };
    expect(streamRouteIssues(draft, { ...check, ctx: ctxOf({ loaded: { upstreams: false } }) })).toEqual([]);
    const sr = saved(await saveResource(api, { kind: 'stream_routes', isNew: true, draft }));
    undo.push(() => api.remove('stream_routes', sr.id));
    expect(sr.value).toMatchObject({ server_port: 9100, upstream_id: up.id });
    const listed = (await api.list('stream_routes')).find((item) => item.id === sr.id);
    expect(listed?.value).toMatchObject({ name: tag, server_port: 9100 });
  });
});
