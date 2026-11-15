// @vitest-environment node
// Empty Lua tables against a real APISIX (dev/compose.yaml): `[]` and `{}` pass either JSON type
// there, non-empty values of the other type don't, and each kind's hand-written check agrees.
// Skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/resources/emptyTables.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// Writes go to one id named after `tag` and are removed. A stream route's protocol shapes go to
// /apisix/admin/schema/validate/stream_routes (the schema only): a real write would stop at
// "unknown protocol", as the dev APISIX enables no xRPC protocol.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import type { Kind, Obj } from '../api/types';
import type { Issue } from '../editor/issues';
import { ctxOf } from '../test/ctx';
import { pluginIssues } from '../plugins/validate';
import { upstreamIssues } from '../upstream/validate';
import type { ValidateEnv } from './registry';
import { routeIssues } from './routes/validate';
import { serviceIssues } from './services/validate';
import { streamRouteIssues } from './stream_routes/validate';

const env = import.meta.env as Record<string, string | undefined>;
const baseUrl = env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180';
const key = env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key';
const api = new AdminClient({ id: 'live', name: 'live', baseUrl, key });
const tag = `apiseven-live-${Date.now().toString(36)}`;
const check: ValidateEnv = { isNew: true, ctx: ctxOf({ loaded: { services: false, upstreams: false, streamRoutes: false } }) };
const NODES = { nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }] };

async function stores(kind: Kind, body: Obj): Promise<boolean> {
  try {
    await api.replace(kind, tag, body);
  } catch {
    return false;
  }
  await api.remove(kind, tag);
  return true;
}

async function schemaTakes(body: Obj): Promise<boolean> {
  const res = await fetch(`${baseUrl}/apisix/admin/schema/validate/stream_routes`, { method: 'POST', headers: { 'X-API-KEY': key }, body: JSON.stringify(body) });
  return res.status === 200;
}

const CASES: [kind: Kind, body: Obj, issues: (d: Obj) => Issue[]][] = [
  ['routes', { uri: `/${tag}`, upstream: NODES, labels: [] }, (d) => routeIssues(d, check)],
  ['routes', { uri: `/${tag}`, upstream: NODES, labels: ['a'] }, (d) => routeIssues(d, check)],
  ['routes', { uri: `/${tag}`, upstream: NODES, vars: {} }, (d) => routeIssues(d, check)],
  ['routes', { uri: `/${tag}`, upstream: NODES, vars: { a: 1 } }, (d) => routeIssues(d, check)],
  ['routes', { uri: `/${tag}`, upstream: NODES, methods: {} }, (d) => routeIssues(d, check)],
  ['services', { labels: [] }, (d) => serviceIssues(d, check)],
  ['services', { labels: ['a'] }, (d) => serviceIssues(d, check)],
  ['services', { hosts: {} }, (d) => serviceIssues(d, check)],
  ['upstreams', { ...NODES, labels: [], checks: { active: [] } }, (d) => upstreamIssues(d)],
  ['upstreams', { ...NODES, checks: { active: ['x'] } }, (d) => upstreamIssues(d)],
  ['stream_routes', { server_port: 9199, labels: [] }, (d) => streamRouteIssues(d, check)],
  ['stream_routes', { server_port: 9199, labels: ['a'] }, (d) => streamRouteIssues(d, check)],
];

// Task 16b item 64: plugin configs with an empty table of the other type, checked as the editor checks
// them (against this APISIX's own plugin schemas), and read back as stored.
const PLUGIN_CASES: Obj[] = [
  { 'forward-auth': { uri: 'http://a.test', request_headers: {} }, 'file-logger': { path: 'logs/zz.log', log_format: [] } },
  { 'forward-auth': { uri: 'http://a.test', request_headers: { a: 1 } } },
  { 'file-logger': { path: 'logs/zz.log', log_format: ['x'] } },
  // Fix round 1, R4.1: an empty table meets the position's other rules as the expected type.
  { cors: { allow_origins_by_regex: {} } },
  { 'fault-injection': { abort: [] } },
];

const PROTOCOLS: Obj[] = [
  { name: 'redis', conf: [], logger: {} },
  { name: 'redis', logger: [{ name: 'syslog', filter: {}, conf: [] }] },
  { name: 'redis', conf: ['x'] },
  { name: 'redis', logger: { a: 1 } },
  { name: 'redis', logger: [{ name: 'syslog', filter: { a: 1 }, conf: {} }] },
  { name: 'redis', logger: [{ name: 'syslog', conf: ['x'] }] },
];

describe.skipIf(env.APISIX_LIVE !== '1')('empty tables: the checks agree with a live APISIX', () => {
  afterAll(async () => {
    for (const kind of ['routes', 'stream_routes', 'services', 'upstreams'] as Kind[]) await api.remove(kind, tag).catch(() => undefined);
  });

  it.each(CASES)('%s %j', async (kind, body, issues) => {
    expect(await stores(kind, body)).toBe(issues(body).length === 0);
  });

  it.each(PLUGIN_CASES)('route plugins %j: the editor check agrees; what is stored comes back as sent', async (plugins) => {
    const all = await api.allPlugins();
    const body = { uri: `/${tag}`, upstream: NODES, plugins };
    const local = pluginIssues(body, { ...check, plugins: all }, 'route');
    let stored: Obj | undefined;
    try {
      await api.replace('routes', tag, body);
      stored = (await api.get('routes', tag)).value;
      await api.remove('routes', tag);
    } catch {
      stored = undefined;
    }
    expect(stored !== undefined).toBe(local.length === 0);
    if (stored) {
      expect(stored.plugins).toEqual(plugins);
      expect(pluginIssues(stored, { ...check, plugins: all }, 'route')).toEqual([]);
    }
  });

  it.each(PROTOCOLS)('stream route protocol %j (the schema)', async (protocol) => {
    const body = { server_port: 9199, protocol };
    expect(await schemaTakes(body)).toBe(streamRouteIssues(body, check).length === 0);
  });
});
