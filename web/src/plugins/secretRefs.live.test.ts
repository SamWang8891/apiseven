// @vitest-environment node
// A secret reference in a plugin's settings, against a real APISIX (dev/compose.yaml); skipped
// otherwise:   APISIX_LIVE=1 npx vitest run src/plugins/secretRefs.live.test.ts
// APISIX's schema check skips a "$secret://" / "$env://" string at every node whose type is absent
// or "string" (core/schema.lua 37–45, secret.lua 268–281). Each case is PUT on a route, and the
// local check (validatePlugins, against the schemas this APISIX publishes) must give APISIX's
// verdict, accepted and refused alike. It writes routes named after `tag` and removes them.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ApiError } from '../api/errors';
import type { Obj } from '../api/types';
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

/** Whether APISIX stores a route with these plugins (it is removed afterwards). */
async function stored(id: string, plugins: Obj): Promise<boolean> {
  try {
    await api.replace('routes', id, { uri: `/${id}`, plugins, upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } });
    undo.push(() => api.remove('routes', id));
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) return false;
    throw err;
  }
}

const CASES: [string, Obj, boolean][] = [
  ['a pattern (proxy-rewrite host), $env://', { 'proxy-rewrite': { host: '$env://APISEVEN_UPSTREAM_HOST' } }, true],
  ['an enum (proxy-rewrite method)', { 'proxy-rewrite': { method: '$env://METHOD' } }, true],
  ['minLength and a pattern (proxy-rewrite uri), $secret://', { 'proxy-rewrite': { uri: '$secret://vault/1/uri' } }, true],
  ['$Env:// in mixed case', { 'proxy-rewrite': { host: '$Env://APISEVEN_UPSTREAM_HOST' } }, true],
  ['a oneOf without a type (limit-count count)', { 'limit-count': { count: '$env://COUNT', time_window: 60 } }, true],
  ['a oneOf of a string and an object (_meta.error_response)', { 'proxy-rewrite': { host: 'a.test', _meta: { error_response: '$env://ERROR' } } }, true],
  ['$SECRET:// in upper case', { 'proxy-rewrite': { host: '$SECRET://vault/1/host' } }, false],
  ['a reference later in the text', { 'proxy-rewrite': { host: 'x$env://y' } }, false],
  ['an integer node (limit-count rejected_code)', { 'limit-count': { count: 1, time_window: 60, rejected_code: '$env://CODE' } }, false],
  ['a reference that makes an if hold (limit-count policy: then redis_host is required)', { 'limit-count': { count: 1, time_window: 60, policy: '$env://POLICY' } }, false],
];

describe.skipIf(env.APISIX_LIVE !== '1')('a secret reference in a plugin setting, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it.each(CASES.map((c, i) => [...c, i] as const))('%s: APISIX and the local check agree (stored: %s)', async (_, plugins, accepted, i) => {
    const all = await api.allPlugins();
    expect(await stored(`${tag}-${i}`, plugins), 'APISIX').toBe(accepted);
    expect(validatePlugins(plugins as Record<string, Obj>, all, 'route').length === 0, 'the local check').toBe(accepted);
  });
});
