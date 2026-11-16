// What a route takes from the objects it references can't be told while their lists are loading
// (Ctx.loaded): a locked view then says "loading…", never a definite "Any host" or "no plugins"; and
// once a list's read failed it can't be told at all: "unknown", naming the list.
import type { Kind, Obj } from '../../api/types';
import type { Ctx } from '../ctx';

const hasId = (v: unknown): boolean => (typeof v === 'string' && v !== '') || typeof v === 'number';

/**
 * Which inherited parts are not known yet: the service's (hosts, plugins, upstream), the plugin
 * config's (plugins), each true while its list has not loaded; `failed`, the kinds whose list's read
 * failed among those (then never "loading": unknown).
 */
export function inheritLoading(draft: Obj, ctx: Ctx): { service: boolean; pluginConfig: boolean; failed: Kind[] } {
  const service = hasId(draft.service_id) && !ctx.loaded.services;
  const pluginConfig = hasId(draft.plugin_config_id) && !ctx.loaded.pluginConfigs;
  return {
    service,
    pluginConfig,
    failed: [...(service && ctx.failed.services ? ['services' as const] : []), ...(pluginConfig && ctx.failed.pluginConfigs ? ['plugin_configs' as const] : [])],
  };
}
