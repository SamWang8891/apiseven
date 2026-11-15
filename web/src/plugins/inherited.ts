// The plugins an object also runs from the objects it uses: a route's service and plugin config, a
// stream route's service, a consumer's group.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import type { Ctx } from '../resources/ctx';
import { asStreamRoute, effectivePlugins, resolveRef } from '../resources/resolve';
import { runsOnStream } from './stream';
import type { InheritedPlugin } from './PluginsTab';

/**
 * The plugins a route also runs from its service and its plugin config (APISIX lays the plugin
 * config's over the service's, so a name in both comes from the plugin config), sorted by name.
 */
export function inheritedPlugins(route: Obj, ctx: Ctx): InheritedPlugin[] {
  return effectivePlugins({ ...route, plugins: undefined }, ctx).flatMap(({ name, from, disabled }) =>
    from === 'service' || from === 'plugin_config' ? [{ name, from, disabled }] : [],
  );
}

/** A stream route's: only from a service it merges with, and only what the stream subsystem runs (asStreamRoute, runsOnStream). */
export function streamInheritedPlugins(route: Obj, ctx: Ctx): InheritedPlugin[] {
  return inheritedPlugins(asStreamRoute(route), ctx).filter((p) => runsOnStream(p.name));
}

/**
 * A consumer's: its consumer group's plugins, sorted by name. For a request authenticated as the
 * consumer, APISIX lays the group's plugins over the route's and then the consumer's own over those
 * (merge_consumer_route, apisix/plugin.lua 818–867), so the consumer wins a name it sets too
 * ("overridden here"). Nothing comes from its credentials: a request signed with one runs as a copy
 * of the consumer with that credential as its auth config only (apisix/consumer.lua 103–118, 144).
 * Empty while the group is unknown (missing, or the groups still loading: consumerGroupLoading).
 */
export function consumerInheritedPlugins(consumer: Obj, ctx: Ctx): InheritedPlugin[] {
  const plugins = resolveRef('consumer_groups', consumer.group_id, ctx)?.item?.value.plugins;
  if (!isObj(plugins)) return [];
  return Object.entries(plugins)
    .map(([name, conf]): InheritedPlugin => ({ name, from: 'consumer_group', disabled: isObj(conf) && isObj(conf._meta) && conf._meta.disable === true }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Whether a consumer's group (it has one) is still loading, so what it inherits is not known yet. */
export const consumerGroupLoading = (consumer: Obj, ctx: Ctx): boolean => resolveRef('consumer_groups', consumer.group_id, ctx) !== undefined && !ctx.loaded.consumerGroups;
