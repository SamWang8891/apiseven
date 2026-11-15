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
import { atEncryptPath, isSecretName, REMOVE } from '../schema/secrets';
import { isDisabled } from './meta';
import type { Scope } from './scope';
import { AUTH_PLUGINS, HTTP_PLUGINS } from './subsystems';

const AUTH = new Set(AUTH_PLUGINS);
const BUILT_IN = new Set(HTTP_PLUGINS);

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
 * Whether `name` is an auth plugin, or undefined while that can't be known: a plugin that is not
 * built in, before the plugin list has loaded (a custom plugin may be one).
 */
export function authPluginOrUnknown(name: string, all?: Record<string, PluginInfo>): boolean | undefined {
  if (all === undefined && !BUILT_IN.has(name)) return undefined;
  return isAuthPlugin(name, all);
}

/**
 * What a plugin of a consumer or credential is for sign-in, so the card and the chips claim only
 * what is true:
 * - 'signIn': an auth plugin. APISIX collects every auth config of every consumer and credential for
 *   matching without looking at `_meta.disable` (plugin_consumer, apisix/consumer.lua 150–193;
 *   create_consume_cache 251–274 and find_consumer 287–297 don't either), so "off" revokes nothing
 *   (signInOf says what it does instead). Elsewhere `_meta.disable` does switch a plugin off:
 *   plugin.filter skips it (plugin.lua 595–597).
 * - 'unused': the loaded list doesn't have it, so APISIX doesn't use the entry (plugin_consumer
 *   skips a plugin plugin.get doesn't know, consumer.lua 166–167; plugin.filter skips it on a route).
 * - 'unknown': not built in, and the list hasn't loaded: nothing definite can be said.
 * - undefined: any other plugin, or any other scope: its switch means what it says.
 * Every plugin of a credential is an auth plugin (APISIX refuses others, admin/credentials.lua
 * 38–45), so one the list knows is 'signIn' unless the list says otherwise; a built-in one is
 * classified by the generated lists before the list loads.
 */
export function signInRole(scope: Scope, name: string, info: PluginInfo | undefined, listLoaded: boolean): 'signIn' | 'unused' | 'unknown' | undefined {
  if (scope !== 'consumer' && scope !== 'credential') return undefined;
  if (info) return info.type === 'auth' ? 'signIn' : undefined;
  if (listLoaded) return 'unused';
  if (!BUILT_IN.has(name)) return 'unknown';
  return AUTH.has(name) ? 'signIn' : undefined;
}

/**
 * The field of each auth plugin's consumer config that APISIX looks the entry up by, the one
 * find_consumer or consumers_kv is called with: key-auth.lua 85, basic-auth.lua 139–140,
 * jwt-auth.lua 314, hmac-auth.lua 140, jwe-decrypt.lua 196, ldap-auth.lua 158,
 * ldap-auth-advanced.lua 387, wolf-rbac.lua 303 and 373 (consumer.lua's plugin_unique_key_attrs,
 * 302–309, lists the first six). A config without it is never found: create_consume_cache skips it
 * (consumer.lua 256–265); and once it changes, nothing that named the old value finds it, whatever
 * else the config holds. So it is the field revoke advice names. multi-auth has none (no consumer
 * schema: the plugins it lists match their own configs), and a custom auth plugin's is not known.
 */
export const SIGN_IN_FIELD: Readonly<Record<string, string>> = {
  'basic-auth': 'username',
  'hmac-auth': 'key_id',
  'jwe-decrypt': 'key',
  'jwt-auth': 'key',
  'key-auth': 'key',
  'ldap-auth': 'user_dn',
  'ldap-auth-advanced': 'user_dn',
  'wolf-rbac': 'appid',
};

/**
 * Whether the plugin's entry is used to decrypt a token rather than to sign a request in: jwe-decrypt
 * attaches no consumer, it decrypts a token whose `kid` names the entry's key (jwe-decrypt.lua 245–255).
 */
export const decryptsOnly = (name: string): boolean => name === 'jwe-decrypt';

/**
 * The field a found entry is then checked against, without which no request passes: basic-auth's
 * password (basic-auth.lua 153–165), hmac-auth's secret_key (hmac-auth.lua 254–256), jwe-decrypt's
 * secret (jwe-decrypt.lua 152–155), jwt-auth's secret for an HS algorithm (the default) and its
 * public_key for any other (get_auth_secret, jwt-auth.lua 279–285). key-auth's key is all there is;
 * ldap-auth's and wolf-rbac's users are checked by their servers.
 */
function verifierOf(name: string, conf: Obj): string | undefined {
  switch (name) {
    case 'basic-auth':
      return 'password';
    case 'hmac-auth':
      return 'secret_key';
    case 'jwe-decrypt':
      return 'secret';
    case 'jwt-auth':
      return typeof conf.algorithm !== 'string' || conf.algorithm.startsWith('HS') ? 'secret' : 'public_key';
    default:
      return undefined;
  }
}

/** What a consumer's or credential's auth plugin (signInRole 'signIn') does, for its badge and notes. */
export interface SignIn {
  /**
   * 'on': not marked off. Marked off (which APISIX ignores here): 'stillSignsIn' (for jwe-decrypt:
   * still used) with the fields it is found by and checked against; 'signsNobodyIn' without one of
   * them; 'offIgnored' when the plugin's lookup field is not known (multi-auth, a custom plugin).
   */
  state: 'on' | 'stillSignsIn' | 'signsNobodyIn' | 'offIgnored';
  /** The field the entry is looked up by (SIGN_IN_FIELD), when known: the one to change to revoke it. */
  field?: string;
  /** For 'signsNobodyIn': the field it lacks (the lookup field, or the one a found entry is checked against). */
  missing?: string;
}

/** signIn facts for the auth plugin `name` configured as `conf`. */
export function signInOf(name: string, conf: unknown): SignIn {
  const field = SIGN_IN_FIELD[name];
  if (!field) return { state: isDisabled(conf) ? 'offIgnored' : 'on' };
  if (!isDisabled(conf)) return { state: 'on', field };
  const config = isObj(conf) ? conf : {};
  const verifier = verifierOf(name, config);
  const missing = config[field] === undefined ? field : verifier !== undefined && config[verifier] === undefined ? verifier : undefined;
  return missing ? { state: 'signsNobodyIn', field, missing } : { state: 'stillSignsIn', field };
}

/** The lookup fields (SIGN_IN_FIELD) a copy's `plugins` still hold: the same as the original's, so they must change. */
export function sharedSignInFields(plugins: Obj): { plugin: string; field: string }[] {
  return Object.entries(plugins)
    .flatMap(([plugin, conf]) => {
      const field = SIGN_IN_FIELD[plugin];
      return field && isObj(conf) && conf[field] !== undefined ? [{ plugin, field }] : [];
    })
    .sort((a, b) => (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
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

/** What a copy left out of one plugin: the secret fields it removed, or the whole config and why. */
export type RemovedSecret =
  | { plugin: string; fields: string[] }
  /** The whole config: the plugin list doesn't know the plugin, couldn't load, or names no secret field for this auth plugin. */
  | { plugin: string; why: 'unknown' | 'unloaded' | 'noSecretFields' };

/** The secret fields of an auth plugin's consumer schema (its encrypt_fields); the loaded list's, else AUTH_SECRETS. */
function signInSecretsOf(name: string, all: Record<string, PluginInfo> | null): readonly string[] {
  const listed: unknown = all?.[name]?.consumer_schema?.encrypt_fields;
  if (all) return Array.isArray(listed) ? listed.filter((f): f is string => typeof f === 'string') : [];
  return AUTH_SECRETS[name] ?? [];
}

/** Whether the copy leaves `conf` out whole (nothing to say when it is empty). */
const hasContent = (conf: unknown): boolean => !isObj(conf) || Object.keys(conf).length > 0;

/**
 * A consumer's or credential's `plugins` for a copy, which must be given its own sign-in secrets
 * (APISIX's duplicate-key check is best effort, consumer.lua 337–348), failing closed:
 * - an auth plugin loses each secret field of its consumer schema (`encrypt_fields`, walked at any
 *   depth and through lists by atEncryptPath) and any top-level key named like a secret; an auth
 *   plugin whose schema names no secret field is left out whole (which field signs in is unknown);
 * - a plugin `all` (the loaded plugin list) doesn't know is left out whole; with `all` null (the list
 *   failed to load) the source's lists classify the built-in plugins, and any other is left out whole;
 * - every other plugin is kept as it is.
 * `removed` says exactly what was left out, for the copy's note.
 */
export function withoutSignInSecrets(plugins: Obj, all: Record<string, PluginInfo> | null): { plugins: Obj; removed: RemovedSecret[] } {
  const removed: RemovedSecret[] = [];
  const out = Object.fromEntries(
    Object.entries(plugins).map(([name, conf]): [string, unknown] => {
      const dropped = (why: 'unknown' | 'unloaded' | 'noSecretFields'): [string, unknown] => {
        if (hasContent(conf)) removed.push({ plugin: name, why });
        return [name, {}];
      };
      if (all ? all[name] === undefined : !BUILT_IN.has(name)) return dropped(all ? 'unknown' : 'unloaded');
      if (!isAuthPlugin(name, all ?? undefined) || !isObj(conf)) return [name, conf];
      const fields = signInSecretsOf(name, all);
      if (fields.length === 0) return dropped('noSecretFields');
      const gone: string[] = [];
      let kept: unknown = conf;
      for (const field of fields) {
        const next = atEncryptPath(kept, field.split('.'), () => REMOVE);
        if (JSON.stringify(next) !== JSON.stringify(kept)) gone.push(field);
        kept = next;
      }
      for (const key of Object.keys(kept as Obj).filter(isSecretName)) {
        kept = atEncryptPath(kept, [key], () => REMOVE);
        gone.push(key);
      }
      if (gone.length > 0) removed.push({ plugin: name, fields: gone });
      return [name, kept];
    }),
  );
  return { plugins: out, removed: removed.sort((a, b) => (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0)) };
}
