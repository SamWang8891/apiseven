import { useMemo } from 'react';
import { useList, useSupports } from '../api/hooks';
import type { Item, Kind } from '../api/types';

/** The lists of a Ctx, by field name. */
export type CtxList = 'routes' | 'streamRoutes' | 'services' | 'upstreams' | 'ssls' | 'pluginConfigs' | 'consumerGroups' | 'consumers' | 'globalRules';

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
  /** Global rules: what uses a proto through grpc-transcode (the sidebar's count already fetches the list). */
  globalRules: Item[];
  /**
   * Whether each list has loaded at least once. Until then its array is empty though the objects may
   * exist, so an id that matches nothing in it is not yet a dangling reference.
   */
  loaded: Record<CtxList, boolean>;
}

/** One shared empty list, so a list that has not loaded keeps the same identity across renders. */
const NONE: Item[] = [];

function useItems(kind: Kind): [Item[], boolean] {
  // Data stays while a refetch fails; a list that never loaded (loading, error) is empty.
  const data = useList(kind).data;
  return [data ?? NONE, data !== undefined];
}

/**
 * Every list the resolvers need, from the shared query cache. The object keeps its identity until
 * one of the lists (or whether it has loaded) changes (React Query hands back the same array when a
 * refetch brings the same data), so it can sit in dependency arrays and memoised table rows.
 */
export function useCtx(): Ctx {
  const [routes, routesLoaded] = useItems('routes');
  const [streamRoutes, streamRoutesListed] = useItems('stream_routes');
  // An APISIX without stream mode answers 4xx for stream routes (AdminClient.supports): it has none,
  // so the empty list is the whole truth and counts as loaded. (The sidebar asks the same, cached.)
  const streamOff = useSupports('stream_routes') === false;
  const streamRoutesLoaded = streamRoutesListed || streamOff;
  const [services, servicesLoaded] = useItems('services');
  const [upstreams, upstreamsLoaded] = useItems('upstreams');
  const [ssls, sslsLoaded] = useItems('ssls');
  const [pluginConfigs, pluginConfigsLoaded] = useItems('plugin_configs');
  const [consumerGroups, consumerGroupsLoaded] = useItems('consumer_groups');
  const [consumers, consumersLoaded] = useItems('consumers');
  const [globalRules, globalRulesLoaded] = useItems('global_rules');
  const loaded = useMemo(
    () => ({
      routes: routesLoaded,
      streamRoutes: streamRoutesLoaded,
      services: servicesLoaded,
      upstreams: upstreamsLoaded,
      ssls: sslsLoaded,
      pluginConfigs: pluginConfigsLoaded,
      consumerGroups: consumerGroupsLoaded,
      consumers: consumersLoaded,
      globalRules: globalRulesLoaded,
    }),
    [routesLoaded, streamRoutesLoaded, servicesLoaded, upstreamsLoaded, sslsLoaded, pluginConfigsLoaded, consumerGroupsLoaded, consumersLoaded, globalRulesLoaded],
  );
  return useMemo(
    () => ({ routes, streamRoutes, services, upstreams, ssls, pluginConfigs, consumerGroups, consumers, globalRules, loaded }),
    [routes, streamRoutes, services, upstreams, ssls, pluginConfigs, consumerGroups, consumers, globalRules, loaded],
  );
}
