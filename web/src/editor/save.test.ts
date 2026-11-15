import { describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ApiError } from '../api/errors';
import { stripTimestamps } from '../api/sanitize';
import type { Kind, Obj } from '../api/types';
import { DEV_CONN } from '../test/app';
import { fakeAdmin, json, type FakeAdminOptions } from '../test/fakeAdmin';
import { setPath } from './draft';
import { mergePatch, saveResource } from './save';

function setup(opts: FakeAdminOptions) {
  const admin = fakeAdmin({ counts: {}, ...opts });
  const client = new AdminClient(DEV_CONN, admin.fetch);
  const writes = () =>
    admin.requests
      .filter((r) => r.method !== 'GET')
      .map((r) => ({ method: r.method, path: r.url.pathname.replace(/^.*\/apisix\/admin\//, ''), body: r.body }));
  return { admin, client, writes };
}

const ROUTE: Obj = {
  id: 'r1',
  uri: '/a',
  x_future: { a: 1 },
  upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }], create_time: 1, update_time: 2 },
  plugins: { cors: { allow_origins: '*', update_time: 5 } },
  create_time: 1700000000,
  update_time: 1700000100,
};

/** Loads a stored object the way the editor does: the item, and its value without timestamps as the draft. */
async function load(client: AdminClient, kind: Kind, id: string) {
  const original = await client.get(kind, id);
  return { original, draft: stripTimestamps(original.value) };
}

describe('saveResource, edit', () => {
  it('Review Focus 1: the PUT body is the loaded object plus the one change, unknown fields included', async () => {
    const { client, writes } = setup({ objects: { routes: [ROUTE] } });
    const { original, draft } = await load(client, 'routes', 'r1');
    const changed = setPath(draft, ['uri'], '/b');
    const result = await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: changed, original });
    expect(result.ok).toBe(true);
    const put = writes();
    expect(put).toHaveLength(1);
    expect(put[0]?.method).toBe('PUT');
    expect(put[0]?.path).toBe('routes/r1');
    expect(put[0]?.body).toEqual({
      id: 'r1',
      uri: '/b',
      x_future: { a: 1 },
      upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] },
      plugins: { cors: { allow_origins: '*' } },
    });
  });

  it('sends no create_time / update_time at the top level, in upstream or in a plugin, even if the draft has them', async () => {
    const { client, writes } = setup({ objects: { routes: [ROUTE] } });
    const original = await client.get('routes', 'r1');
    await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: original.value, original });
    const body = writes()[0]?.body as Obj;
    expect(JSON.stringify(body)).not.toMatch(/create_time|update_time/);
  });

  it('returns the stored object re-read after the write, with its new modifiedIndex', async () => {
    const { client } = setup({ objects: { routes: [ROUTE] } });
    const { original, draft } = await load(client, 'routes', 'r1');
    const result = await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: { ...draft, uri: '/b' }, original });
    if (!result.ok || !('item' in result)) throw new Error('expected a saved item');
    expect(result.item.value.uri).toBe('/b');
    expect(result.item.modifiedIndex).toBeGreaterThan(original.modifiedIndex ?? Infinity);
  });

  it('conflict: a higher modifiedIndex on the server means no PUT, and the server item comes back', async () => {
    const { admin, client, writes } = setup({ objects: { routes: [ROUTE] } });
    const { original, draft } = await load(client, 'routes', 'r1');
    admin.touch('routes', 'r1', { uri: '/theirs' });
    const result = await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: { ...draft, uri: '/mine' }, original });
    expect(result).toMatchObject({ ok: false, conflict: { id: 'r1', value: { uri: '/theirs' } } });
    expect(writes()).toEqual([]);
  });

  it('with force the PUT is sent despite the conflict', async () => {
    const { admin, client, writes } = setup({ objects: { routes: [ROUTE] } });
    const { original, draft } = await load(client, 'routes', 'r1');
    admin.touch('routes', 'r1', { uri: '/theirs' });
    const result = await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: { ...draft, uri: '/mine' }, original, force: true });
    expect(result.ok).toBe(true);
    expect(writes()).toMatchObject([{ method: 'PUT', path: 'routes/r1', body: { uri: '/mine' } }]);
    expect(admin.stored('routes')[0]?.uri).toBe('/mine');
  });

  it("APISIX's refusal comes back as the ApiError, with error_msg verbatim", async () => {
    const msg = 'invalid configuration: property "uri" validation failed: wrong type: expected string, got number';
    const { client } = setup({
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(400, { error_msg: msg }) : undefined) },
    });
    const { original, draft } = await load(client, 'routes', 'r1');
    const result = await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: { ...draft, uri: 5 }, original });
    if (result.ok || !('error' in result)) throw new Error('expected an error');
    expect(result.error).toBeInstanceOf(ApiError);
    expect(result.error.errorMsg).toBe(msg);
    expect(result.error.status).toBe(400);
  });
});

describe('saveResource, create', () => {
  it('without an id: POST to the collection; the result is the stored object', async () => {
    const { client, writes } = setup({ objects: { routes: [] } });
    const result = await saveResource(client, { kind: 'routes', isNew: true, draft: { uri: '/new', status: 1 } });
    expect(writes()).toMatchObject([{ method: 'POST', path: 'routes', body: { uri: '/new', status: 1 } }]);
    if (!result.ok || !('item' in result)) throw new Error('expected a created item');
    expect(result.item.id).toMatch(/^\d{20}$/);
    expect(result.item.modifiedIndex).toEqual(expect.any(Number));
  });

  it('with an id: PUT to that id, with the id left out of the body as the draft had it', async () => {
    const { client, writes } = setup({ objects: { global_rules: [] } });
    const result = await saveResource(client, { kind: 'global_rules', id: 'g 1', isNew: true, draft: { plugins: { cors: {} } } });
    expect(result.ok).toBe(true);
    expect(writes()).toEqual([{ method: 'PUT', path: 'global_rules/g%201', body: { plugins: { cors: {} } } }]);
  });
});

describe('saveResource, SSL', () => {
  const SSL: Obj = {
    id: 's1',
    cert: 'CERT',
    key: 'ENCRYPTED',
    snis: ['a.test'],
    labels: { env: 'dev', team: 'web' },
    type: 'server',
    update_time: 2,
  };

  it('an edit changing only snis sends PATCH {snis:[…]}', async () => {
    const { client, writes } = setup({ objects: { ssls: [SSL] } });
    const { original, draft } = await load(client, 'ssls', 's1');
    expect(draft.key).toBeUndefined();
    const result = await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: { ...draft, snis: ['a.test', 'b.test'] }, original });
    expect(result.ok).toBe(true);
    expect(writes()).toEqual([{ method: 'PATCH', path: 'ssls/s1', body: { snis: ['a.test', 'b.test'] } }]);
  });

  it('a top-level key the user removed goes as null; a removed label as a nested null (APISIX merges objects)', async () => {
    const { admin, client, writes } = setup({ objects: { ssls: [SSL] } });
    const { original, draft } = await load(client, 'ssls', 's1');
    const next = setPath(setPath(draft, ['type'], undefined), ['labels', 'team'], undefined);
    await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: next, original });
    expect(writes()).toEqual([{ method: 'PATCH', path: 'ssls/s1', body: { type: null, labels: { team: null } } }]);
    expect(admin.stored('ssls')[0]).toEqual({ id: 's1', cert: 'CERT', key: 'ENCRYPTED', snis: ['a.test'], labels: { env: 'dev' }, update_time: 2 });
  });

  it('a draft containing key (certificate replaced) sends a full PUT', async () => {
    const { client, writes } = setup({ objects: { ssls: [SSL] } });
    const { original, draft } = await load(client, 'ssls', 's1');
    await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: { ...draft, cert: 'NEW CERT', key: 'NEW KEY' }, original });
    expect(writes()).toMatchObject([{ method: 'PUT', path: 'ssls/s1', body: { cert: 'NEW CERT', key: 'NEW KEY', snis: ['a.test'] } }]);
  });

  it('the saved item is re-read, so it never carries the key a write response echoes', async () => {
    const { client } = setup({ objects: { ssls: [SSL] } });
    const { original, draft } = await load(client, 'ssls', 's1');
    const result = await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: { ...draft, snis: ['c.test'] }, original });
    if (!result.ok || !('item' in result)) throw new Error('expected a saved item');
    expect(result.item.value.key).toBeUndefined();
    expect(result.item.value.snis).toEqual(['c.test']);
  });
});

describe('a write APISIX answers with its secrets encrypted (consumers, credentials)', () => {
  const JO: Obj = { username: 'jo', plugins: { 'key-auth': { key: 'jo-key' } } };

  it('the saved item is the re-read one: the key in clear, never the ciphertext the PUT echoed', async () => {
    const { client } = setup({ objects: { consumers: [JO] } });
    const { original, draft } = await load(client, 'consumers', 'jo');
    const result = await saveResource(client, { kind: 'consumers', id: 'jo', isNew: false, draft: { ...draft, desc: 'Jo' }, original });
    if (!result.ok || !('item' in result)) throw new Error('expected a saved item');
    expect(result.item.value.plugins).toEqual({ 'key-auth': { key: 'jo-key' } });
  });

  it('when the re-read fails, the plugins stand in as sent, not as echoed (encrypted again on a later save, the key would be lost)', async () => {
    let reads = 0;
    const { client } = setup({
      credentials: { jo: [{ id: 'c1', plugins: { 'key-auth': { key: 'c1-key' } } }] },
      // The editor's conflict check reads first; the read after the PUT fails.
      replies: { 'consumers/jo/credentials/c1': (req) => (req.method === 'GET' && ++reads > 2 ? json(503, { error_msg: 'etcd busy' }) : undefined) },
    });
    const original = await client.get('credentials', 'c1', { consumer: 'jo' });
    const draft = { ...stripTimestamps(original.value), desc: 'CI' };
    const result = await saveResource(client, { kind: 'credentials', id: 'c1', isNew: false, draft, original, parent: { consumer: 'jo' } });
    if (!result.ok || !('item' in result)) throw new Error('expected a saved item');
    expect(result.item.value.plugins).toEqual({ 'key-auth': { key: 'c1-key' } });
    expect(result.item.value.desc).toBe('CI');
    expect(result.item.modifiedIndex).toBeUndefined();
  });
});

describe('when the read after a write fails, what was sent stands in: never a value the write response echoed', () => {
  /** A reply that fails the first GET after each write to `path` (the frame's re-read). */
  function failReadAfterWrite() {
    let wrote = false;
    return (req: { method: string }) => {
      if (req.method !== 'GET') {
        wrote = true;
        return undefined;
      }
      if (!wrote) return undefined;
      wrote = false;
      return json(503, { error_msg: 'etcd busy' });
    };
  }
  /** The saved item (or a failure), and the item's next save (force: the stand-in has no modifiedIndex). */
  function saved(result: Awaited<ReturnType<typeof saveResource>>) {
    if (!result.ok || !('item' in result)) throw new Error('expected a saved item');
    return result.item;
  }
  const SECRET = 'Bearer plain-secret';
  const logger = { 'http-logger': { uri: 'http://127.0.0.1:1/log', auth_header: SECRET } };
  const PEM = '-----BEGIN PRIVATE KEY-----\nMIGHAgEA\n-----END PRIVATE KEY-----';

  it.each(['routes', 'services', 'global_rules', 'plugin_configs', 'consumer_groups'] as const)(
    "%s: a plugin's encrypt_fields (http-logger auth_header) stand in as sent; the next Save sends the original secret",
    async (kind) => {
      const { client, writes } = setup({ objects: { [kind]: [{ id: 'x1', uri: '/x', plugins: logger, x_future: 1 }] }, replies: { [`${kind}/x1`]: failReadAfterWrite() } });
      const { original, draft } = await load(client, kind, 'x1');
      const item = saved(await saveResource(client, { kind, id: 'x1', isNew: false, draft: { ...draft, desc: 'one' }, original }));
      // The PUT's response echoed the secret encrypted; the stand-in has it as sent.
      expect(item.value.plugins).toEqual(logger);
      expect(item.modifiedIndex).toBeUndefined();
      await saveResource(client, { kind, id: 'x1', isNew: false, draft: { ...stripTimestamps(item.value), desc: 'two' }, original: item, force: true });
      expect(writes().map((w) => (w.body as Obj).plugins)).toEqual([logger, logger]);
      expect(JSON.stringify(writes())).not.toContain('$ENC$');
    },
  );

  it("an upstream's tls.client_key: a new PEM key stands in as sent (APISIX echoes its AES ciphertext); the next Save sends it again", async () => {
    const { client, admin, writes } = setup({ objects: { upstreams: [{ id: 'u1', nodes: [{ host: 'a', port: 443, weight: 1 }], tls: { client_cert: 'CERT', client_key: 'AES:stored' } }] }, replies: { 'upstreams/u1': failReadAfterWrite() } });
    const { original, draft } = await load(client, 'upstreams', 'u1');
    const item = saved(await saveResource(client, { kind: 'upstreams', id: 'u1', isNew: false, draft: { ...draft, tls: { client_cert: 'CERT', client_key: PEM } }, original }));
    expect((item.value.tls as Obj).client_key).toBe(PEM);
    await saveResource(client, { kind: 'upstreams', id: 'u1', isNew: false, draft: { ...stripTimestamps(item.value), desc: 'again' }, original: item, force: true });
    expect(writes().map((w) => ((w.body as Obj).tls as Obj).client_key)).toEqual([PEM, PEM]);
    // Stored encrypted once, as APISIX does with a PEM key.
    expect((admin.stored('upstreams')[0]?.tls as Obj).client_key).toBe(`AES:${btoa(encodeURIComponent(PEM))}`);
  });

  it("an upstream's stored client_key (GET returns APISIX's ciphertext): an unrelated save sends it back as loaded", async () => {
    const { client, admin, writes } = setup({ objects: { upstreams: [{ id: 'u1', nodes: [{ host: 'a', port: 443, weight: 1 }], tls: { client_cert: 'CERT', client_key: 'AES:stored' } }] } });
    const { original, draft } = await load(client, 'upstreams', 'u1');
    await saveResource(client, { kind: 'upstreams', id: 'u1', isNew: false, draft: { ...draft, desc: 'x' }, original });
    expect(((writes()[0]?.body as Obj).tls as Obj).client_key).toBe('AES:stored');
    expect((admin.stored('upstreams')[0]?.tls as Obj).client_key).toBe('AES:stored');
  });

  it("a route's inline upstream client_key: the same", async () => {
    const { client, writes } = setup({ objects: { routes: [{ id: 'r1', uri: '/a', upstream: { nodes: [{ host: 'a', port: 443, weight: 1 }], scheme: 'https' } }] }, replies: { 'routes/r1': failReadAfterWrite() } });
    const { original, draft } = await load(client, 'routes', 'r1');
    const upstream = { ...(draft.upstream as Obj), tls: { client_cert: 'CERT', client_key: PEM } };
    const item = saved(await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: { ...draft, upstream }, original }));
    expect(((item.value.upstream as Obj).tls as Obj).client_key).toBe(PEM);
    await saveResource(client, { kind: 'routes', id: 'r1', isNew: false, draft: stripTimestamps(item.value), original: item, force: true });
    expect(writes().map((w) => (((w.body as Obj).upstream as Obj).tls as Obj).client_key)).toEqual([PEM, PEM]);
  });

  it("an SSL's key: left out of the stand-in, as a GET leaves it out; the next Save is a PATCH without it, the stored key untouched", async () => {
    const { client, admin, writes } = setup({ objects: { ssls: [{ id: 's1', cert: 'CERT', key: 'AES:old', snis: ['a.test'] }] }, replies: { 'ssls/s1': failReadAfterWrite() } });
    const { original, draft } = await load(client, 'ssls', 's1');
    const item = saved(await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: { ...draft, cert: 'NEW CERT', key: PEM }, original }));
    expect(item.value.key).toBeUndefined();
    expect(item.value.cert).toBe('NEW CERT');
    await saveResource(client, { kind: 'ssls', id: 's1', isNew: false, draft: { ...stripTimestamps(item.value), snis: ['b.test'] }, original: item, force: true });
    expect(writes().map((w) => w.method)).toEqual(['PUT', 'PATCH']);
    expect(writes()[1]?.body).toEqual({ snis: ['b.test'] });
    expect(admin.stored('ssls')[0]?.key).toBe(`AES:${btoa(encodeURIComponent(PEM))}`);
  });

  it('a POST: the id APISIX generated comes from the response (nothing else does); the secret stands in as sent', async () => {
    let wrote = false;
    const { client } = setup({
      objects: { routes: [] },
      replies: {
        routes: (req) => {
          wrote ||= req.method === 'POST';
          return undefined;
        },
      },
    });
    // Fail every read of the new route (its id is not known in advance).
    const fetchImpl = (client as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    (client as unknown as { fetchImpl: typeof fetch }).fetchImpl = (input, init) =>
      wrote && (init?.method ?? 'GET') === 'GET' ? Promise.resolve(json(503, { error_msg: 'etcd busy' })) : fetchImpl(input, init);
    const item = saved(await saveResource(client, { kind: 'routes', isNew: true, draft: { uri: '/new', plugins: logger } }));
    expect(item.id).toMatch(/^\d{20}$/);
    expect(item.value).toEqual({ uri: '/new', plugins: logger, id: item.id });
  });
});

describe('mergePatch', () => {
  it('holds only the changed top-level keys, removed ones as null', () => {
    expect(mergePatch({ a: 1, b: [1], c: 'x' }, { a: 1, b: [1, 2], d: true })).toEqual({ b: [1, 2], c: null, d: true });
    expect(mergePatch({ a: 1 }, { a: 1 })).toEqual({});
  });

  it('diffs nested objects that are non-empty on both sides; anything else is sent whole', () => {
    expect(mergePatch({ o: { x: 1, y: { z: 1, w: 2 } } }, { o: { x: 1, y: { z: 2, w: 2 } } })).toEqual({ o: { y: { z: 2 } } });
    // APISIX replaces an empty table and anything that is an array instead of merging.
    expect(mergePatch({ o: {} }, { o: { x: 1 } })).toEqual({ o: { x: 1 } });
    expect(mergePatch({ o: { x: 1 } }, { o: {} })).toEqual({ o: {} });
    expect(mergePatch({ o: [1] }, { o: { x: 1 } })).toEqual({ o: { x: 1 } });
  });
});
