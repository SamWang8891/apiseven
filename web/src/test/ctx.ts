import type { Item, Obj } from '../api/types';
import type { Ctx } from '../resources/ctx';

/** A stored object as the client returns it; `value.id` repeats the id, as APISIX stores it. */
export function itemOf(id: string, value: Obj = {}): Item {
  return { id, value: { id, ...value } };
}

/** A Ctx with every list empty except the ones given. */
export function ctxOf(parts: Partial<Ctx> = {}): Ctx {
  return {
    routes: [],
    streamRoutes: [],
    services: [],
    upstreams: [],
    ssls: [],
    pluginConfigs: [],
    consumerGroups: [],
    consumers: [],
    ...parts,
  };
}
