// @vitest-environment node
// Global rules, plugin configs, plugin metadata, protos and secrets as the editors save them, against
// a real APISIX (dev/compose.yaml) and its gateway; skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/resources/remaining.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key),
// APISIX_GATEWAY_URL (default http://127.0.0.1:9080). Every object it writes is named after `tag` and
// removed; a plugin metadata entry that existed before is put back as it was.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ApiError } from '../api/errors';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, PluginInfo } from '../api/types';
import { pathOfError } from '../editor/issues';
import { saveResource, type SaveResult } from '../editor/save';
import { ctxOf } from '../test/ctx';
import { globalRuleIssues } from './global_rules/validate';
import { pluginConfigIssues } from './plugin_configs/validate';
import { metadataIssues } from './plugin_metadata/validate';
import { toBase64 } from './protos/content';
import { protoIssues } from './protos/validate';
import type { ValidateEnv } from './registry';
import { SECRET_FIELDS, type Manager } from './secrets/schemas';
import { secretIssues } from './secrets/validate';

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
let plugins: Record<string, PluginInfo> | undefined;
const check = async (id?: string): Promise<ValidateEnv> => {
  plugins ??= await api.allPlugins();
  return { isNew: true, ctx: ctxOf(), plugins, id };
};

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : 'exists' in result ? 'an existing object' : 'unchecked' in result ? result.unchecked.message : result.error.message}`);
  return result.item;
}

/** What the editor sends on Save after the user changed `change` only: GET, then the loaded draft with it. */
async function editOnly(kind: Kind, id: string, change: (draft: Obj) => Obj): Promise<Item> {
  const original = await api.get(kind, id);
  return saved(await saveResource(api, { kind, id, isNew: false, draft: change(stripTimestamps(original.value)), original }));
}

async function gone(kind: Kind, id: string): Promise<boolean> {
  try {
    await api.get(kind, id);
    return false;
  } catch (err) {
    return err instanceof ApiError && err.status === 404;
  }
}

async function refusal(write: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await write();
    return undefined;
  } catch (err) {
    return err instanceof ApiError ? err.errorMsg : String(err);
  }
}

describe.skipIf(env.APISIX_LIVE !== '1')('the Task 15 kinds against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('plugin metadata for http-logger: set (a PUT to /plugin_metadata/http-logger, no timestamps), read, reset', async () => {
    const before = await api.get('plugin_metadata', 'http-logger').catch(() => undefined);
    if (before) undo.push(() => api.replace('plugin_metadata', 'http-logger', stripTimestamps(before.value)));
    else undo.push(() => api.remove('plugin_metadata', 'http-logger'));
    if (before) await api.remove('plugin_metadata', 'http-logger');

    const draft: Obj = { log_format: { host: '$host', tag } };
    expect(metadataIssues(draft, await check('http-logger'))).toEqual([]);
    const created = saved(await saveResource(api, { kind: 'plugin_metadata', id: 'http-logger', isNew: true, draft }));
    expect(created.value).toEqual({ id: 'http-logger', log_format: { host: '$host', tag } });
    // A create of an entry that exists meanwhile is refused (editor/save.ts holderOf), nothing written.
    const again = await saveResource(api, { kind: 'plugin_metadata', id: 'http-logger', isNew: true, draft: { log_format: {} } });
    expect(again.ok === false && 'exists' in again).toBe(true);
    expect((await api.get('plugin_metadata', 'http-logger')).value).toEqual(created.value);
    // A schema refusal is APISIX's too.
    expect(metadataIssues({ max_pending_entries: 0 }, await check('http-logger')).map((i) => i.path)).toEqual(['max_pending_entries']);
    expect(await refusal(() => api.replace('plugin_metadata', 'http-logger', { max_pending_entries: 0 }))).toMatch(/^invalid configuration: property "max_pending_entries"/);
    await api.remove('plugin_metadata', 'http-logger');
    expect(await gone('plugin_metadata', 'http-logger')).toBe(true);
  });

  it("plugin metadata's encrypted field (azure-functions master_apikey): two saves that leave it alone keep what was first sent", async () => {
    const before = await api.get('plugin_metadata', 'azure-functions').catch(() => undefined);
    undo.push(() => (before ? api.replace('plugin_metadata', 'azure-functions', stripTimestamps(before.value)) : api.remove('plugin_metadata', 'azure-functions')));
    const sent = `key-${tag}`;
    const created = saved(await saveResource(api, { kind: 'plugin_metadata', id: 'azure-functions', isNew: before === undefined, draft: { master_apikey: sent, master_clientid: 'a' }, ...(before ? { original: before } : {}) }));
    // The write's echo is ciphertext; the editor keeps the re-read, which is clear.
    expect(created.value.master_apikey).toBe(sent);
    for (const id of ['b', 'c']) await editOnly('plugin_metadata', 'azure-functions', (d) => ({ ...d, master_clientid: id }));
    expect((await api.get('plugin_metadata', 'azure-functions')).value).toMatchObject({ master_apikey: sent, master_clientid: 'c' });
  });

  it("a global rule's plugin secret (http-logger auth_header) survives saves that leave it alone; removing every plugin stores plugins: {}; a plugin another rule holds is refused, on that plugin", async () => {
    const id = `${tag}-gr`;
    const secret = `Bearer ${tag}`;
    const draft: Obj = { plugins: { 'http-logger': { uri: 'http://127.0.0.1:1980/log', auth_header: secret } } };
    expect(globalRuleIssues(draft, await check())).toEqual([]);
    saved(await saveResource(api, { kind: 'global_rules', id, isNew: true, draft }));
    undo.push(() => api.remove('global_rules', id));
    for (const uri of ['http://127.0.0.1:1980/a', 'http://127.0.0.1:1980/b']) {
      await editOnly('global_rules', id, (d) => ({ ...d, plugins: { 'http-logger': { ...((d.plugins as Obj)['http-logger'] as Obj), uri } } }));
    }
    expect(((await api.get('global_rules', id)).value.plugins as Obj)['http-logger']).toMatchObject({ auth_header: secret, uri: 'http://127.0.0.1:1980/b' });

    const message = await refusal(() => api.replace('global_rules', `${tag}-gr2`, { plugins: { 'http-logger': { uri: 'http://x' } } }));
    expect(message).toBe(`plugin 'http-logger' already exists in global rule with id '${id}'`);
    expect(pathOfError(message)).toBe('plugins.http-logger');

    const emptied = await editOnly('global_rules', id, (d) => ({ ...d, plugins: {} }));
    expect(globalRuleIssues(stripTimestamps(emptied.value), await check())).toEqual([]);
    expect(Object.keys(emptied.value.plugins as Obj)).toEqual([]);
  });

  it('a global rule applies to every request, also one no route matches', async () => {
    const id = `${tag}-gw`;
    saved(await saveResource(api, { kind: 'global_rules', id, isNew: true, draft: { plugins: { 'response-rewrite': { headers: { set: { 'X-Apiseven-Live': tag } } } } } }));
    undo.push(() => api.remove('global_rules', id));
    let res = await fetch(`${gateway}/${tag}/no-such-route`);
    for (let i = 0; i < 40 && res.headers.get('X-Apiseven-Live') !== tag; i++) {
      await new Promise((r) => setTimeout(r, 250));
      res = await fetch(`${gateway}/${tag}/no-such-route`);
    }
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Apiseven-Live')).toBe(tag);
  });

  it("a plugin config a route names: APISIX refuses to delete it, in the words the dialog shows", async () => {
    const id = `${tag}-pc`;
    const draft: Obj = { name: id, plugins: { 'response-rewrite': { headers: { set: { 'X-Pc': '1' } } } } };
    expect(pluginConfigIssues(draft, await check())).toEqual([]);
    saved(await saveResource(api, { kind: 'plugin_configs', id, isNew: true, draft }));
    undo.push(() => api.remove('plugin_configs', id));
    const route = saved(await saveResource(api, { kind: 'routes', isNew: true, draft: { uri: `/${tag}/pc`, plugin_config_id: id, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } } }));
    undo.push(() => api.remove('routes', route.id));
    expect(await refusal(() => api.remove('plugin_configs', id))).toBe(`can not delete this plugin config, route [${route.id}] is still using it now`);
  });

  it('a proto: source and a compiled descriptor set (base64) are both stored; a route that uses it blocks its delete', async () => {
    const id = `${tag}-proto`;
    const source = 'syntax = "proto3";\npackage live;\nmessage M { string a = 1; }\n';
    expect(protoIssues({ content: source })).toEqual([]);
    saved(await saveResource(api, { kind: 'protos', id, isNew: true, draft: { name: id, content: source } }));
    undo.push(() => api.remove('protos', id));
    // FileDescriptorSet { file { name: "a.proto" package: "live" message_type { name: "M" } } }
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const file = [0x0a, 7, ...enc('a.proto'), 0x12, 4, ...enc('live'), 0x22, 3, 0x0a, 1, ...enc('M')];
    const descriptor = toBase64(new Uint8Array([0x0a, file.length, ...file]));
    const edited = await editOnly('protos', id, (d) => ({ ...d, content: descriptor }));
    expect(edited.value.content).toBe(descriptor);
    expect(await refusal(() => api.replace('protos', id, { content: 'not a proto' }))).toMatch(/^invalid content: /);

    const route = saved(
      await saveResource(api, {
        kind: 'routes',
        isNew: true,
        draft: { uri: `/${tag}/grpc`, plugins: { 'grpc-transcode': { proto_id: id, service: 'live.S', method: 'M' } }, upstream: { scheme: 'grpc', nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } },
      }),
    );
    undo.push(() => api.remove('routes', route.id));
    expect(await refusal(() => api.remove('protos', id))).toBe(`can not delete this proto, route [${route.id}] is still using it now`);
  });

  const MINIMAL: Record<Manager, Obj> = {
    vault: { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: `hvs.${tag}` },
    aws: { access_key_id: `AKIA${tag}`, secret_access_key: `aws-${tag}` },
    gcp: { auth_config: { client_email: 'live@example.com', private_key: `pk-${tag}`, project_id: 'live' } },
  };

  it.each(Object.keys(MINIMAL) as Manager[])(
    '%s: a minimal entry APISIX stores has no local issue; GET returns its credentials in clear; the id round-trips with its slash (list, get, save, delete)',
    async (manager) => {
      const id = `${manager}/${tag}`;
      const draft = MINIMAL[manager];
      expect(secretIssues(draft, await check(id))).toEqual([]);
      const created = saved(await saveResource(api, { kind: 'secrets', id, isNew: true, draft }));
      undo.push(() => api.remove('secrets', id));
      expect(created.id).toBe(id);
      expect(created.value.id).toBe(id);
      // Clear text on GET: an untouched save sends them back as they are.
      for (const path of SECRET_FIELDS[manager]) {
        const read = path.split('.').reduce<unknown>((at, key) => (at as Obj | undefined)?.[key], created.value);
        const sent = path.split('.').reduce<unknown>((at, key) => (at as Obj | undefined)?.[key], draft);
        if (sent !== undefined) expect(read, path).toBe(sent);
      }
      expect((await api.list('secrets')).map((item) => item.id)).toContain(id);
      const edited = await editOnly('secrets', id, (d) => ({ ...d, note: 'x' }));
      expect(stripTimestamps(edited.value)).toEqual({ ...draft, id, note: 'x' });
      // Create never overwrites, with the slash.
      const again = await saveResource(api, { kind: 'secrets', id, isNew: true, draft });
      expect(again.ok === false && 'exists' in again).toBe(true);
      await api.remove('secrets', id);
      expect(await gone('secrets', id)).toBe(true);
    },
  );

  it("a secret manager's schema refuses what the transcription refuses (vault without a token)", async () => {
    const id = `vault/${tag}-bad`;
    const draft = { uri: 'http://127.0.0.1:8200', prefix: 'p' };
    expect(secretIssues(draft, await check(id)).map((i) => i.path)).toEqual(['token']);
    expect(await refusal(() => api.replace('secrets', id, draft))).toMatch(/^invalid configuration: property "token" is required/);
  });
});
