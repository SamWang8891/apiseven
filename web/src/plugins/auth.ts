// Auth plugins (`type = 'auth'`): a route's sign a request in and find its consumer. One that reaches
// a route through the consumer or its group never runs: merge_consumer_route lays the group's and the
// consumer's plugins over the route's (apisix/plugin.lua 818–867), and the rewrite phase run for
// them then skips every plugin of type auth in the merged config, whatever it came from
// (plugin.lua 612–614, run_plugin 1454–1460). Every auth plugin of APISIX 3.20 has a rewrite phase
// and no other (key-auth, basic-auth, jwt-auth, hmac-auth, jwe-decrypt, ldap-auth,
// ldap-auth-advanced, multi-auth, wolf-rbac), so it does nothing there. A consumer's own auth plugins
// are its credentials (what the route's auth plugin matches), not plugins that run.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { isSecretName } from '../schema/secrets';
import type { Scope } from './scope';
import { AUTH_PLUGINS } from './subsystems';

const AUTH = new Set(AUTH_PLUGINS);

/**
 * Whether `name` is an auth plugin: by the connected APISIX's plugin list once it has loaded (a
 * custom auth plugin included), else by the source's list (subsystems.ts, generated), so a list
 * column can decide synchronously.
 */
export function isAuthPlugin(name: string, all?: Record<string, PluginInfo>): boolean {
  const info = all?.[name];
  return info ? info.type === 'auth' : AUTH.has(name);
}

/**
 * Whether a plugin in `scope` signs requests in whatever its `_meta.disable` says: an auth plugin of
 * a consumer or a credential. APISIX collects every auth config of every consumer and credential
 * for matching without looking at `_meta.disable` (plugin_consumer, apisix/consumer.lua 150–193;
 * create_consume_cache 251–274 and find_consumer 287–297 don't either), so "off" there revokes
 * nothing. (Elsewhere `_meta.disable` does switch a plugin off: plugin.filter skips it, plugin.lua
 * 595–597, which covers a route's auth plugin and a consumer's or group's other plugins.)
 * `info` is the plugin as the loaded list has it; without it, the source's auth list decides.
 */
export function signsInAlways(scope: Scope, name: string, info?: PluginInfo): boolean {
  return (scope === 'consumer' || scope === 'credential') && isAuthPlugin(name, info ? { [name]: info } : undefined);
}

/**
 * The secret fields of each auth plugin's consumer schema (its `encrypt_fields`) in APISIX 3.20, for
 * when the plugin list has not loaded (a test keeps it equal to the fixture's).
 */
export const AUTH_SECRETS: Readonly<Record<string, readonly string[]>> = {
  'basic-auth': ['password'],
  'hmac-auth': ['secret_key'],
  'jwe-decrypt': ['key', 'secret'],
  'jwt-auth': ['secret'],
  'key-auth': ['key'],
};

/** An auth plugin's sign-in secret fields: its consumer schema's encrypt_fields (the loaded list's, else AUTH_SECRETS). */
function signInSecretsOf(name: string, all?: Record<string, PluginInfo>): readonly string[] {
  const listed: unknown = all?.[name]?.consumer_schema?.encrypt_fields;
  return Array.isArray(listed) ? listed.filter((f): f is string => typeof f === 'string') : (AUTH_SECRETS[name] ?? []);
}

/**
 * A consumer's or credential's `plugins` for a copy: each auth plugin without its sign-in secrets
 * (its secret fields, and any key named like a secret), which the copy must be given anew (APISIX's
 * duplicate-key check is best effort, consumer.lua 337–348). `cleared` names the plugins that lost one.
 */
export function withoutSignInSecrets(plugins: Obj, all?: Record<string, PluginInfo>): { plugins: Obj; cleared: string[] } {
  const cleared: string[] = [];
  const out = Object.fromEntries(
    Object.entries(plugins).map(([name, conf]) => {
      if (!isObj(conf) || !isAuthPlugin(name, all)) return [name, conf];
      const secrets = new Set(signInSecretsOf(name, all));
      const kept = Object.fromEntries(Object.entries(conf).filter(([key]) => !secrets.has(key) && !isSecretName(key)));
      if (Object.keys(kept).length !== Object.keys(conf).length) cleared.push(name);
      return [name, kept];
    }),
  );
  return { plugins: out, cleared: cleared.sort() };
}
