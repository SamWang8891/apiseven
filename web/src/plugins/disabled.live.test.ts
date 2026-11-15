// @vitest-environment node
// What APISIX checks in a switched-off plugin, against a real APISIX (dev/compose.yaml); skipped
// otherwise:   APISIX_LIVE=1 npx vitest run src/plugins/disabled.live.test.ts
// A switched-off plugin whose config fails its schema is stored ("accepting it anyway",
// apisix/plugin.lua 1033–1046); switched on, the same config is refused. validatePlugins must agree,
// or the editor would block what APISIX stores. It writes one route and one consumer group named
// after `tag` and removes them.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ApiError } from '../api/errors';
import type { Kind, Obj } from '../api/types';
import { validatePlugins } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

/** The status APISIX answers a PUT with: 2xx stored, else its error status. */
async function put(kind: Kind, id: string, body: Obj): Promise<number> {
  try {
    await api.replace(kind, id, body);
    undo.push(() => api.remove(kind, id));
    return 200;
  } catch (err) {
    if (err instanceof ApiError && err.status !== undefined) return err.status;
    throw err;
  }
}

describe.skipIf(env.APISIX_LIVE !== '1')('a switched-off plugin with a config that fails its schema, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it.each([
    ['routes', 'route', (plugins: Obj) => ({ uri: `/${tag}`, plugins, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } })],
    ['consumer_groups', 'consumer_group', (plugins: Obj) => ({ plugins })],
  ] as const)('%s: stored when off, refused when on; validatePlugins agrees', async (kind, scope, body) => {
    const all = await api.allPlugins();
    const off = { 'limit-count': { _meta: { disable: true } } };
    const on = { 'limit-count': {} };
    expect(validatePlugins(off, all, scope)).toEqual([]);
    expect(await put(kind, `${tag}-off`, body(off))).toBe(200);
    expect(validatePlugins(on, all, scope).length).toBeGreaterThan(0);
    expect(await put(kind, `${tag}-on`, body(on))).toBe(400);
  });
});
