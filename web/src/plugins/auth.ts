// Auth plugins (`type = 'auth'`): a route's sign a request in and find its consumer. One that reaches
// a route through the consumer or its group never runs: merge_consumer_route lays the group's and the
// consumer's plugins over the route's (apisix/plugin.lua 818–867), and the rewrite phase run for
// them then skips every plugin of type auth in the merged config, whatever it came from
// (plugin.lua 612–614, run_plugin 1454–1460). Every auth plugin of APISIX 3.20 has a rewrite phase
// and no other (key-auth, basic-auth, jwt-auth, hmac-auth, jwe-decrypt, ldap-auth,
// ldap-auth-advanced, multi-auth, wolf-rbac), so it does nothing there. A consumer's own auth plugins
// are its credentials (what the route's auth plugin matches), not plugins that run.
import type { PluginInfo } from '../api/types';
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
