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
