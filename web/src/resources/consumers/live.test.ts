// @vitest-environment node
// Consumers and their credentials as the editors save them, against a real APISIX (dev/compose.yaml)
// and its gateway; skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/resources/consumers/live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key),
// APISIX_GATEWAY_URL (default http://127.0.0.1:9080). APISIX stores an auth plugin's key encrypted,
// returns it in clear on GET and echoes the ciphertext on PUT: a save that leaves the key alone must
// leave it working at the gateway. It creates consumers, credentials and routes named after `tag`
// (the routes proxy to the dev etcd, whose /version answers JSON), and removes them.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../../api/client';
import { stripTimestamps } from '../../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../../api/types';
import { saveResource, type SaveResult } from '../../editor/save';
import { ctxOf } from '../../test/ctx';
import { credentialIssues } from '../credentials/validate';
import { consumerIssues } from './validate';

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
const check = { isNew: true, ctx: ctxOf({ loaded: { consumerGroups: false } }) };

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : result.error.message}`);
  return result.item;
}

/** What the editor does on Save after the user changed only the description: GET, then a full PUT of the loaded draft. */
async function describeOnly(kind: Kind, id: string, desc: string, parent?: Parent): Promise<Item> {
  const original = await api.get(kind, id, parent);
  const draft = { ...stripTimestamps(original.value), desc };
  return saved(await saveResource(api, { kind, id, isNew: false, draft, original, parent }));
}

/** A route at /version?live=<route>, proxied to the dev etcd, guarded by `plugins`. */
async function guardedRoute(name: string, plugins: Obj): Promise<string> {
  const route = saved(await saveResource(api, { kind: 'routes', isNew: true, draft: { name, uri: '/version', vars: [['arg_live', '==', name]], plugins, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } } }));
  undo.push(() => api.remove('routes', route.id));
  return `${gateway}/version?live=${name}`;
}

/** The gateway's status once it has caught up with etcd (a moment after a write). */
async function statusOf(url: string, headers: Record<string, string>, expected: number): Promise<number> {
  let res = await fetch(url, { headers });
  for (let i = 0; i < 40 && res.status !== expected; i++) {
    await new Promise((r) => setTimeout(r, 250));
    res = await fetch(url, { headers });
  }
  return res.status;
}

describe.skipIf(env.APISIX_LIVE !== '1')('consumers and credentials against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('a key-auth credential lets its consumer in; a save that changes only its description keeps the key working', async () => {
    const username = `${tag}-a`;
    const consumer: Obj = { username, desc: 'live' };
    expect(consumerIssues(consumer, check)).toEqual([]);
    saved(await saveResource(api, { kind: 'consumers', id: username, isNew: true, draft: consumer }));
    undo.push(() => api.remove('consumers', username));

    const parent = { consumer: username };
    const key = `${tag}-key`;
    const credential: Obj = { name: 'ci', plugins: { 'key-auth': { key } } };
    expect(credentialIssues(credential, check)).toEqual([]);
    const created = saved(await saveResource(api, { kind: 'credentials', id: 'ci', isNew: true, draft: credential, parent }));
    undo.push(() => api.remove('credentials', 'ci', parent));
    // The Admin API's GET has the key in clear (the frame re-reads after every write).
    expect(created.value.plugins).toEqual({ 'key-auth': { key } });

    const url = await guardedRoute(`${tag}-ka`, { 'key-auth': {} });
    expect(await statusOf(url, { apikey: key }, 200)).toBe(200);
    expect(await statusOf(url, {}, 401)).toBe(401);

    const after = await describeOnly('credentials', 'ci', 'only the description', parent);
    expect(after.value.plugins).toEqual({ 'key-auth': { key } });
    expect(await statusOf(url, { apikey: key }, 200)).toBe(200);
    expect(await statusOf(url, { apikey: 'wrong' }, 401)).toBe(401);
    expect(await statusOf(url, {}, 401)).toBe(401);
  });

  it("a consumer's own key-auth key survives a save that changes only its description", async () => {
    const username = `${tag}-b`;
    const key = `${tag}-own`;
    saved(await saveResource(api, { kind: 'consumers', id: username, isNew: true, draft: { username, plugins: { 'key-auth': { key } } } }));
    undo.push(() => api.remove('consumers', username));

    const url = await guardedRoute(`${tag}-own`, { 'key-auth': {} });
    expect(await statusOf(url, { apikey: key }, 200)).toBe(200);
    const after = await describeOnly('consumers', username, 'only the description');
    expect(after.value.plugins).toEqual({ 'key-auth': { key } });
    expect(await statusOf(url, { apikey: key }, 200)).toBe(200);
    expect(await statusOf(url, {}, 401)).toBe(401);
  });

  it('a basic-auth credential: its password survives a save that changes only its description', async () => {
    const username = `${tag}-c`;
    saved(await saveResource(api, { kind: 'consumers', id: username, isNew: true, draft: { username } }));
    undo.push(() => api.remove('consumers', username));
    const parent = { consumer: username };
    const user = `${tag}-u`;
    const password = `${tag}-pw`;
    saved(await saveResource(api, { kind: 'credentials', id: 'pw', isNew: true, draft: { plugins: { 'basic-auth': { username: user, password } } }, parent }));
    undo.push(() => api.remove('credentials', 'pw', parent));

    const url = await guardedRoute(`${tag}-ba`, { 'basic-auth': {} });
    const basic = { Authorization: `Basic ${btoa(`${user}:${password}`)}` };
    expect(await statusOf(url, basic, 200)).toBe(200);
    const after = await describeOnly('credentials', 'pw', 'only the description', parent);
    expect(after.value.plugins).toEqual({ 'basic-auth': { username: user, password } });
    expect(await statusOf(url, basic, 200)).toBe(200);
    expect(await statusOf(url, {}, 401)).toBe(401);
  });
});
