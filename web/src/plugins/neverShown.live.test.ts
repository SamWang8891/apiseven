// @vitest-environment node
// What the final wave's D1 and D5 rest on, against a real APISIX (dev/compose.yaml); skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/plugins/neverShown.live.test.ts
// D1: a private key in traffic-split's own upstream is stored and read back as sent, in clear (only a
// route's or service's own upstream goes through upstream.encrypt_conf, apisix/upstream.lua 748–753),
// which is why no view may show it. D5: the plugins the Admin API reports as `scope: "global"` are
// among those runsForInstance names. It writes one route named after `tag` and removes it.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import type { Obj } from '../api/types';
import { runsForInstance } from './scope';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

// Long enough for private_key_schema and certificate_scheme (minLength 128, schema_def.lua); traffic-split
// checks only the schema of its upstreams (traffic-split.lua 105–137), not the pair.
const KEY = `-----BEGIN PRIVATE KEY-----\n${'K'.repeat(160)}\n-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----\n${'C'.repeat(160)}\n-----END CERTIFICATE-----`;

describe.skipIf(env.APISIX_LIVE !== '1')('never-shown keys and instance-wide plugins, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('traffic-split’s upstream tls.client_key is read back as sent, in clear', async () => {
    const split = { rules: [{ weighted_upstreams: [{ upstream: { type: 'roundrobin', scheme: 'https', nodes: { 'etcd:2379': 1 }, tls: { client_cert: CERT, client_key: KEY } }, weight: 1 }, { weight: 1 }] }] };
    await api.replace('routes', tag, { uri: `/${tag}`, plugins: { 'traffic-split': split }, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } });
    undo.push(() => api.remove('routes', tag));
    const stored = await api.get('routes', tag);
    const rules = ((stored.value.plugins as Obj)['traffic-split'] as Obj).rules as Obj[];
    const upstream = ((rules[0]?.weighted_upstreams as Obj[])[0]?.upstream ?? {}) as Obj;
    expect((upstream.tls as Obj).client_key).toBe(KEY);
  });

  it('every plugin the Admin API reports as scope "global" is one runsForInstance names (3.20 loads ai by default)', async () => {
    const all = await api.allPlugins();
    const global = Object.entries(all).filter(([, info]) => info.scope === 'global').map(([name]) => name);
    expect(global).toContain('ai');
    for (const name of global) expect(runsForInstance(name, undefined), name).toBe(true);
  });
});
