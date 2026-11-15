import { skipToken, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, createElement, useCallback, useContext, type FC, type ReactNode } from 'react';
import type { AdminClient } from './client';
import type { ApiError } from './errors';
import type { Item, Kind, Obj, Parent, PluginInfo } from './types';

const ClientContext = createContext<AdminClient | null>(null);

/** Makes `client` the active connection for every hook below it. */
export const ClientProvider: FC<{ client: AdminClient; children: ReactNode }> = ({ client, children }) =>
  createElement(ClientContext, { value: client }, children);

export function useClient(): AdminClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient() needs a <ClientProvider> above it');
  return client;
}

/**
 * Query keys without the connection; the hooks prefix them with its id (see scopedKey).
 * Shapes: [kind, consumer | null, 'list'] and [kind, consumer | null, 'item', id], so the prefix
 * [kind] covers every list and item of a kind, and [kind, consumer] one consumer's credentials.
 */
export const queryKeys = {
  list: (kind: Kind, parent?: Parent): unknown[] => [kind, parent?.consumer ?? null, 'list'],
  item: (kind: Kind, id: string, parent?: Parent): unknown[] => [kind, parent?.consumer ?? null, 'item', id],
};

/** Prefixes a key with the connection id, so switching connections never serves another instance's cache. */
export function scopedKey(connId: string, key: readonly unknown[]): unknown[] {
  return [connId, ...key];
}

/** `enabled: false` asks nothing (and shows what the cache has); `refetchOnWindowFocus: false` for many small lists (a count per row). */
export function useList(kind: Kind, parent?: Parent, opts: { enabled?: boolean; refetchOnWindowFocus?: boolean } = {}): UseQueryResult<Item[], ApiError> {
  const client = useClient();
  return useQuery<Item[], ApiError>({
    queryKey: scopedKey(client.conn.id, queryKeys.list(kind, parent)),
    queryFn: () => client.list(kind, parent),
    ...opts,
  });
}

/** Idle (no request) while `id` is undefined. */
export function useItem(kind: Kind, id: string | undefined, parent?: Parent): UseQueryResult<Item, ApiError> {
  const client = useClient();
  return useQuery<Item, ApiError>({
    queryKey: scopedKey(client.conn.id, queryKeys.item(kind, id ?? '', parent)),
    queryFn: id === undefined ? skipToken : () => client.get(kind, id, parent),
  });
}

/** Every http plugin with its schemas; with 'stream', every stream plugin (for stream routes). */
export function useAllPlugins(subsystem?: 'stream'): UseQueryResult<Record<string, PluginInfo>, ApiError> {
  const client = useClient();
  return useQuery<Record<string, PluginInfo>, ApiError>({
    queryKey: scopedKey(client.conn.id, ['plugins', 'all', subsystem ?? 'http']),
    queryFn: () => client.allPlugins(subsystem),
    // The client caches the result for its lifetime, so refetching would return the same data.
    staleTime: Infinity,
  });
}

/**
 * The plugin list when some page has already fetched it (an editor), else undefined: never a
 * request of its own (the list is large), so a list page's cells can prefer it when it is there.
 */
export function usePluginsIfLoaded(subsystem?: 'stream'): Record<string, PluginInfo> | undefined {
  const client = useClient();
  return useQuery<Record<string, PluginInfo>, ApiError>({
    queryKey: scopedKey(client.conn.id, ['plugins', 'all', subsystem ?? 'http']),
    queryFn: () => client.allPlugins(subsystem),
    enabled: false,
    staleTime: Infinity,
  }).data;
}

/** A resource's JSON schema from this APISIX (`upstream`, `route`, …); see AdminClient.resourceSchema. */
export function useResourceSchema(name: string): UseQueryResult<Obj, ApiError> {
  const client = useClient();
  return useQuery<Obj, ApiError>({
    queryKey: scopedKey(client.conn.id, ['schema', name]),
    queryFn: () => client.resourceSchema(name),
    // The client caches the result for its lifetime; schemas only change with an APISIX upgrade.
    staleTime: Infinity,
  });
}

/**
 * Returns a function that invalidates a kind's list and item queries on the active connection;
 * given a parent, only that consumer's credentials.
 */
export function useInvalidate(): (kind: Kind, parent?: Parent) => Promise<void> {
  const connId = useClient().conn.id;
  const queryClient = useQueryClient();
  return useCallback(
    (kind: Kind, parent?: Parent) =>
      queryClient.invalidateQueries({ queryKey: scopedKey(connId, parent ? [kind, parent.consumer] : [kind]) }),
    [queryClient, connId],
  );
}

/**
 * Whether the connected APISIX has this kind (false on versions without it, or stream routes with
 * stream mode off). Undefined while it is being checked, and when the check itself failed.
 */
export function useSupports(kind: Kind): boolean | undefined {
  const client = useClient();
  return useQuery<boolean, ApiError>({
    queryKey: scopedKey(client.conn.id, ['supports', kind]),
    queryFn: () => client.supports(kind),
    // Endpoints only change with an APISIX upgrade.
    staleTime: Infinity,
  }).data;
}

/** useSupports for each of `kinds` (the same queries, so answers are shared): kind → its answer. */
export function useSupportsAll(kinds: Kind[]): Partial<Record<Kind, boolean>> {
  const client = useClient();
  const answers = useQueries({
    queries: kinds.map((kind) => ({
      queryKey: scopedKey(client.conn.id, ['supports', kind]),
      queryFn: () => client.supports(kind),
      staleTime: Infinity,
    })),
  });
  return Object.fromEntries(kinds.flatMap((kind, i) => (answers[i]?.data === undefined ? [] : [[kind, answers[i].data]])));
}

/** Checks the connection; `version` comes from APISIX's Server header. */
export function usePing(): UseQueryResult<{ version?: string }, ApiError> {
  const client = useClient();
  return useQuery<{ version?: string }, ApiError>({
    queryKey: scopedKey(client.conn.id, ['ping']),
    queryFn: () => client.ping(),
  });
}
