// @vitest-environment node
// What APISIX checks in a switched-off plugin, against a real APISIX (dev/compose.yaml); skipped
// otherwise:   APISIX_LIVE=1 npx vitest run src/plugins/disabled.live.test.ts
// A switched-off plugin whose config fails its schema is stored ("accepting it anyway",
// apisix/plugin.lua 1033–1046); switched on, the same config is refused. validatePlugins must agree,
// or the editor would block what APISIX stores; and what APISIX still refuses of a switched-off
// plugin (its `_meta.filter` and `_meta.pre_function`, 1048–1064) validatePlugins must refuse too.
// It writes routes, a consumer group and a consumer named after `tag` and removes them.
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

  it.each([
    ['routes', 'route', (plugins: Obj) => ({ uri: `/${tag}-meta`, plugins, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } })],
    ['consumers', 'consumer', (plugins: Obj) => ({ username: `${tag.replace(/-/g, '_')}_meta`, plugins })],
  ] as const)('%s: off, a _meta.filter that is not a list or a _meta.pre_function that is not text is still refused (plugin.lua 1048–1064); validatePlugins agrees', async (kind, scope, body) => {
    const all = await api.allPlugins();
    const plugin = scope === 'consumer' ? 'key-auth' : 'limit-count';
    for (const meta of [{ filter: 'arg_x == 1' }, { pre_function: 42 }]) {
      const bad = { [plugin]: { _meta: { disable: true, ...meta } } };
      expect(validatePlugins(bad, all, scope).length, JSON.stringify(meta)).toBeGreaterThan(0);
      const id = kind === 'consumers' ? body(bad).username : `${tag}-meta`;
      // Refused: a 400 for the pre_function (it fails to load as Lua), a 500 for the filter (expr.new
      // raises on a string rather than returning an error).
      expect(await put(kind, id, body(bad)), JSON.stringify(meta)).toBeGreaterThanOrEqual(400);
    }
    // Off and incomplete otherwise (key-auth without its key): stored, and validatePlugins agrees.
    const ok = { [plugin]: { _meta: { disable: true, filter: [['arg_x', '==', '1']] } } };
    expect(validatePlugins(ok, all, scope)).toEqual([]);
    expect(await put(kind, kind === 'consumers' ? body(ok).username : `${tag}-meta`, body(ok))).toBe(200);
  });
});
