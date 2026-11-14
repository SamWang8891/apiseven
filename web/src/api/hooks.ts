import { skipToken, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, createElement, useCallback, useContext, type FC, type ReactNode } from 'react';
import type { AdminClient } from './client';
import type { ApiError } from './errors';
import type { Item, Kind, Parent, PluginInfo } from './types';

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

export function useList(kind: Kind, parent?: Parent): UseQueryResult<Item[], ApiError> {
  const client = useClient();
  return useQuery<Item[], ApiError>({
    queryKey: scopedKey(client.conn.id, queryKeys.list(kind, parent)),
    queryFn: () => client.list(kind, parent),
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

export function useAllPlugins(): UseQueryResult<Record<string, PluginInfo>, ApiError> {
  const client = useClient();
  return useQuery<Record<string, PluginInfo>, ApiError>({
    queryKey: scopedKey(client.conn.id, ['plugins', 'all']),
    queryFn: () => client.allPlugins(),
    // The client caches the result for its lifetime, so refetching would return the same data.
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
