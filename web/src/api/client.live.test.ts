// @vitest-environment node
// Runs against a real APISIX (dev/compose.yaml); skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/api/client.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// Everything it creates is named after `tag` and removed again.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from './client';
import { ApiError } from './errors';
import { stripTimestamps } from './sanitize';
import type { Kind } from './types';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<void>)[] = [];

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`);
  return err;
}

describe.skipIf(env.APISIX_LIVE !== '1')('AdminClient against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('creates, reads, replaces and removes a route', async () => {
    const upstream = { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }] };
    const created = await api.create('routes', { name: tag, uri: `/${tag}`, upstream });
    undo.push(() => api.remove('routes', created.id));
    expect(created.value).toMatchObject({ id: created.id, uri: `/${tag}` });

    const got = await api.get('routes', created.id);
    expect(got.value.uri).toBe(`/${tag}`);
    expect(got.modifiedIndex).toEqual(expect.any(Number));

    // APISIX rejects create_time / update_time on PUT, so a read-modify-write needs stripTimestamps.
    const replaced = await api.replace('routes', created.id, stripTimestamps({ ...got.value, uri: `/${tag}/v2` }));
    expect(replaced.value.uri).toBe(`/${tag}/v2`);
    expect((await api.get('routes', created.id)).modifiedIndex).toBeGreaterThan(got.modifiedIndex ?? 0);

    await api.remove('routes', created.id);
    const gone = await failure(api.get('routes', created.id));
    expect([gone.kind, gone.status]).toEqual(['http', 404]);
  });

  it('allPlugins includes limit-count with a schema', async () => {
    const all = await api.allPlugins();
    expect(all['limit-count']?.schema).toMatchObject({ type: 'object' });
    expect(all['limit-count']?.metadata_schema).toMatchObject({ type: 'object' });
  });

  it('ping reads the version from the Server header', async () => {
    expect((await api.ping()).version).toMatch(/^\d+\.\d+/);
  });

  it('lists every kind', async () => {
    const kinds: Kind[] = [
      'routes', 'services', 'upstreams', 'consumers', 'consumer_groups', 'ssls', 'global_rules',
      'plugin_configs', 'plugin_metadata', 'protos', 'secrets', 'stream_routes',
    ];
    for (const kind of kinds) {
      expect(Array.isArray(await api.list(kind)), kind).toBe(true);
      expect(await api.supports(kind), kind).toBe(true);
    }
    expect(await api.supports('credentials')).toBe(true);
  });

  it('keeps credentials under their consumer', async () => {
    const consumer = tag.replaceAll('-', '_');
    await api.create('consumers', { username: consumer });
    undo.push(() => api.remove('consumers', consumer));
    expect((await api.list('consumers')).map((i) => i.id)).toContain(consumer);

    // No credentials yet: APISIX answers 404, the client an empty list.
    expect(await api.list('credentials', { consumer })).toEqual([]);
    await api.create('credentials', { plugins: { 'key-auth': { key: `${tag}-key` } } }, 'k1', { consumer });
    const creds = await api.list('credentials', { consumer });
    expect(creds.map((i) => i.id)).toEqual(['k1']);
    expect((await api.get('credentials', 'k1', { consumer })).value.plugins).toEqual({ 'key-auth': { key: `${tag}-key` } });
  });

  it('addresses a secret as <manager>/<id>', async () => {
    const id = `vault/${tag} x`;
    await api.replace('secrets', id, { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 't' });
    undo.push(() => api.remove('secrets', id));
    expect((await api.get('secrets', id)).id).toBe(id);
    expect((await api.list('secrets')).map((i) => i.id)).toContain(id);
    expect((await api.patch('secrets', id, { prefix: 'kv/other' })).value.prefix).toBe('kv/other');
    await api.remove('secrets', id);
    expect((await failure(api.get('secrets', id))).status).toBe(404);
  });
});
