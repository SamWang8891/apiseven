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
 * The plugins the picker offers in `scope`, sorted; `all` is the scope's plugin set (the stream set
 * for a stream route). A credential holds only auth plugins with a consumer schema
 * (admin/credentials.lua: "only supports auth type plugins in consumer credential").
 */
export function pluginsAvailable(all: Record<string, PluginInfo>, scope: Scope): string[] {
  const names = Object.keys(all).sort();
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
