import type { Item, Obj } from '../api/types';
import type { Ctx } from '../resources/ctx';

/** A stored object as the client returns it; `value.id` repeats the id, as APISIX stores it. */
export function itemOf(id: string, value: Obj = {}): Item {
  return { id, value: { id, ...value } };
}

const ALL_LOADED: Ctx['loaded'] = {
  routes: true,
  streamRoutes: true,
  services: true,
  upstreams: true,
  ssls: true,
  pluginConfigs: true,
  consumerGroups: true,
  consumers: true,
  globalRules: true,
};

/**
 * A Ctx with every list empty except the ones given, and every list loaded unless `loaded` says
 * otherwise (`ctxOf({ loaded: { upstreams: false } })`).
 */
export function ctxOf(parts: Partial<Omit<Ctx, 'loaded'>> & { loaded?: Partial<Ctx['loaded']> } = {}): Ctx {
  const { loaded, ...lists } = parts;
  return {
    routes: [],
    streamRoutes: [],
    services: [],
    upstreams: [],
    ssls: [],
    pluginConfigs: [],
    consumerGroups: [],
    consumers: [],
    globalRules: [],
    ...lists,
    loaded: { ...ALL_LOADED, ...loaded },
  };
}
