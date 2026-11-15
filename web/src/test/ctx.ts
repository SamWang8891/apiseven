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

const NONE_FAILED: Ctx['failed'] = Object.fromEntries(Object.keys(ALL_LOADED).map((list) => [list, false])) as Ctx['failed'];

/**
 * A Ctx with every list empty except the ones given, and every list loaded unless `loaded` says
 * otherwise (`ctxOf({ loaded: { upstreams: false } })`); none failed unless `failed` says so.
 */
export function ctxOf(parts: Partial<Omit<Ctx, 'loaded' | 'failed'>> & { loaded?: Partial<Ctx['loaded']>; failed?: Partial<Ctx['failed']> } = {}): Ctx {
  const { loaded, failed, ...lists } = parts;
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
    failed: { ...NONE_FAILED, ...failed },
  };
}
