// Where a plugin list lives decides which plugins it may hold and which schema checks each one:
// APISIX checks a consumer's (and a credential's) plugins with the plugin's consumer_schema when it
// has one (plugin.lua check_schema with TYPE_CONSUMER), everything else with its route-side schema,
// a stream route's against the stream subsystem's plugins.
import type { Kind, Obj, PluginInfo } from '../api/types';

export type Scope = 'route' | 'service' | 'consumer' | 'consumer_group' | 'global_rule' | 'plugin_config' | 'stream_route' | 'credential';

/** The scope of each plugin-bearing kind. */
export const scopeOfKind: Partial<Record<Kind, Scope>> = {
  routes: 'route',
  services: 'service',
  consumers: 'consumer',
  consumer_groups: 'consumer_group',
  global_rules: 'global_rule',
  plugin_configs: 'plugin_config',
  stream_routes: 'stream_route',
  credentials: 'credential',
};

/** The subsystem whose plugins a scope takes: undefined for http. */
export const subsystemOf = (scope: Scope): 'stream' | undefined => (scope === 'stream_route' ? 'stream' : undefined);

/**
 * The schema a plugin's config is checked against in `scope`: a consumer's and a credential's use
 * the consumer_schema when the plugin has one (key-auth's `key`); a consumer group's plugins are
 * checked like a route's (admin/consumer_group.lua passes no schema type).
 */
export function schemaFor(info: PluginInfo, scope: Scope): Obj {
  if ((scope === 'consumer' || scope === 'credential') && info.consumer_schema) return info.consumer_schema;
  return info.schema;
}

/**
 * The built-in plugins of APISIX 3.20 that do nothing as an entry of an object's plugins. APISIX runs
 * each from its init() for the whole instance once config.yaml loads it (apisix/plugin.lua 272–273),
 * whatever any object's config says, and its module has no request phase that run_plugin would call
 * for a route, service, consumer, global rule or plugin config (plugin.lua 1463–1464: a plugin without
 * the phase's function is passed over), so neither its settings nor its `_meta.disable` change anything:
 * - `scope = "global"` in the module table (which the Admin API's plugin list reports, admin/plugins.lua
 *   65): ai.lua 56–62 (init, destroy), batch-requests.lua 146–154 (check_schema, api),
 *   error-log-logger.lua 186–193 (check_schema, init, destroy), log-rotate.lua 61–67 (init, destroy),
 *   node-status.lua 31–37 (check_schema, api), server-info.lua 54–60 (check_schema, control_api, init,
 *   destroy);
 * - no scope, but no request phase either: gm.lua 128–133 and ocsp-stapling.lua 36–41 (init, destroy,
 *   check_schema: they act on SSL objects), inspect.lua 31–36 (check_schema, init, destroy).
 */
const INSTANCE_ONLY = new Set(['ai', 'batch-requests', 'error-log-logger', 'gm', 'inspect', 'log-rotate', 'node-status', 'ocsp-stapling', 'server-info']);

/** Whether an entry of `name` in an object's plugins does nothing (INSTANCE_ONLY, or a plugin this APISIX reports as `scope: "global"`). */
export function runsForInstance(name: string, info: PluginInfo | undefined): boolean {
  return INSTANCE_ONLY.has(name) || info?.scope === 'global';
}

/**
 * The plugins the picker offers in `scope`, sorted; `all` is the scope's plugin set (the stream set
 * for a stream route). A credential holds only auth plugins with a consumer schema
 * (admin/credentials.lua: "only supports auth type plugins in consumer credential"). A plugin run for
 * the whole instance (runsForInstance) is offered nowhere: an entry of it would do nothing.
 */
export function pluginsAvailable(all: Record<string, PluginInfo>, scope: Scope): string[] {
  const names = Object.keys(all)
    .filter((name) => !runsForInstance(name, all[name]))
    .sort();
  if (scope !== 'credential') return names;
  return names.filter((name) => all[name]?.type === 'auth' && all[name].consumer_schema !== undefined);
}

/**
 * What `plugins` becomes when its last plugin is removed: gone, except where APISIX requires the
 * field (global rules, plugin configs and consumer groups: `required = {"id", "plugins"}` in
 * schema_def.lua), which keep `{}`.
 */
export function emptyPlugins(scope: Scope): Record<string, Obj> | undefined {
  return scope === 'global_rule' || scope === 'plugin_config' || scope === 'consumer_group' ? {} : undefined;
}
