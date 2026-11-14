import { useMemo } from 'react';
import { useList } from '../api/hooks';
import type { Item, Kind } from '../api/types';

/** The lists the resolvers look objects up in (see resolve.ts). Treat the arrays as read-only. */
export interface Ctx {
  routes: Item[];
  streamRoutes: Item[];
  services: Item[];
  upstreams: Item[];
  ssls: Item[];
  pluginConfigs: Item[];
  consumerGroups: Item[];
  consumers: Item[];
}

/** One shared empty list, so a list that has not loaded keeps the same identity across renders. */
const NONE: Item[] = [];

function useItems(kind: Kind): Item[] {
  // Data stays while a refetch fails; a list that never loaded (loading, error) is empty.
  return useList(kind).data ?? NONE;
}

/**
 * Every list the resolvers need, from the shared query cache. The object keeps its identity until
 * one of the lists changes (React Query hands back the same array when a refetch brings the same
 * data), so it can sit in dependency arrays and memoised table rows.
 */
export function useCtx(): Ctx {
  const routes = useItems('routes');
  const streamRoutes = useItems('stream_routes');
  const services = useItems('services');
  const upstreams = useItems('upstreams');
  const ssls = useItems('ssls');
  const pluginConfigs = useItems('plugin_configs');
  const consumerGroups = useItems('consumer_groups');
  const consumers = useItems('consumers');
  return useMemo(
    () => ({ routes, streamRoutes, services, upstreams, ssls, pluginConfigs, consumerGroups, consumers }),
    [routes, streamRoutes, services, upstreams, ssls, pluginConfigs, consumerGroups, consumers],
  );
}
