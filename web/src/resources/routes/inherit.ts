// What a route takes from the objects it references can't be told while their lists are loading
// (Ctx.loaded): a locked view then says "loading…", never a definite "Any host" or "no plugins".
import type { Obj } from '../../api/types';
import type { Ctx } from '../ctx';

const hasId = (v: unknown): boolean => (typeof v === 'string' && v !== '') || typeof v === 'number';

/** Which inherited parts are still unknown: the service's (hosts, plugins, upstream), the plugin config's (plugins). */
export function inheritLoading(draft: Obj, ctx: Ctx): { service: boolean; pluginConfig: boolean } {
  return {
    service: hasId(draft.service_id) && !ctx.loaded.services,
    pluginConfig: hasId(draft.plugin_config_id) && !ctx.loaded.pluginConfigs,
  };
}
