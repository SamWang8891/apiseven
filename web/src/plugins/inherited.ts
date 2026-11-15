// The plugins a route also runs from its service and its plugin config.
import type { Obj } from '../api/types';
import type { Ctx } from '../resources/ctx';
import { asStreamRoute, effectivePlugins } from '../resources/resolve';
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
