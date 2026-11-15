// @vitest-environment node
// upstreamIssues against a real APISIX (dev/compose.yaml): for each case, the check lets it through
// exactly when APISIX stores it, as an upstream, a service's and a route's inline upstream (the
// default mode: check_upstream_conf), and a stream route's (the schema only). Skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/upstream/checks.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// Each write goes to one id named after `tag`, removed afterwards.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import type { Kind, Obj } from '../api/types';
import { upstreamIssues } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const NODE = { host: '127.0.0.1', port: 1980, weight: 1 };

/** Upstreams the old checks refused or that sit at an edge of a rule, each with what APISIX does. */
const CASES: [name: string, up: Obj][] = [
  ['an empty node list', { nodes: [] }],
  ['an empty node map', { nodes: {} }],
  ['map keys without a host', { nodes: { ':80': 1, '': 1 } }],
  ['an empty discovery type', { discovery_type: '', service_name: 'web' }],
  ['chash on vars_combinations with an empty key', { type: 'chash', hash_on: 'vars_combinations', key: '', nodes: [NODE] }],
  ['chash on vars with an empty key', { type: 'chash', key: '', nodes: [NODE] }],
  ['chash without a key', { type: 'chash', nodes: [NODE] }],
  ['a map port out of range', { nodes: { '127.0.0.1:70000': 1 } }],
  ['an unbracketed IPv6 node host', { nodes: [{ host: '::1', port: 1980, weight: 1 }] }],
  ['nodes beside both discovery keys', { nodes: [NODE], discovery_type: '', service_name: 'web' }],
  ['pass_host rewrite without upstream_host', { nodes: [NODE], pass_host: 'rewrite' }],
  ['no node list nor discovery', { type: 'roundrobin' }],
];

/** Whether APISIX stores `body` under `kind/<tag>` (then removes it). */
async function accepts(kind: Kind, body: Obj): Promise<boolean> {
  try {
    await api.replace(kind, tag, body);
  } catch {
    return false;
  }
  await api.remove(kind, tag);
  return true;
}

describe.skipIf(env.APISIX_LIVE !== '1')('upstreamIssues agrees with a live APISIX', () => {
  afterAll(async () => {
    for (const kind of ['routes', 'stream_routes', 'services', 'upstreams'] as Kind[]) await api.remove(kind, tag).catch(() => undefined);
  });

  it.each(CASES)('%s', async (_, up) => {
    const passes = upstreamIssues(up).length === 0;
    expect(await accepts('upstreams', up), 'as an upstream').toBe(passes);
    expect(await accepts('services', { upstream: up }), "as a service's").toBe(passes);
    expect(await accepts('routes', { uri: `/${tag}`, upstream: up }), "as a route's").toBe(passes);
    const streamPasses = upstreamIssues(up, 'upstream', { checkConf: false }).length === 0;
    expect(await accepts('stream_routes', { server_port: 9199, upstream: up }), "as a stream route's").toBe(streamPasses);
  });
});
