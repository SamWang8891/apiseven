import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { toast } from '../ui/toast';
import type { AdminClient } from './client';
import { ApiError } from './errors';
import { queryKeys, scopedKey, useClient, useInvalidate } from './hooks';
import type { Kind, Parent } from './types';

// Connections whose key turned out read-only (a write came back 401/403), by connection id. Kept in
// memory only: a reload, or a new key (which gets a new connection id), starts over.
const readOnly = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markReadOnly(connId: string): void {
  if (readOnly.has(connId)) return;
  readOnly.add(connId);
  for (const listener of listeners) listener();
}

/** Forgets every read-only mark. For tests. */
export function resetReadOnlyKeys(): void {
  readOnly.clear();
  for (const listener of listeners) listener();
}

/** True once a write on the active connection was refused for the key's role. */
export function useReadOnlyKey(): boolean {
  const connId = useClient().conn.id;
  return useSyncExternalStore(subscribe, () => readOnly.has(connId));
}

/**
 * Why a write on the active connection would not be sent: its key turned out read-only, and useWrite
 * refuses every write at once from then on. Undefined while it may write. What a control that would
 * write says while it is unavailable (aria-disabled, so a keyboard user on it keeps their place).
 */
export function useWriteRefusal(): string | undefined {
  return useReadOnlyKey() ? t('readOnly.unavailable') : undefined;
}

/** Marks the active connection read-only; the Shell then shows its banner. */
export function useMarkReadOnly(): () => void {
  const connId = useClient().conn.id;
  return useCallback(() => markReadOnly(connId), [connId]);
}

export interface WriteOptions {
  /** Lists (and items) to reload after a success: a kind, or one consumer's credentials. */
  invalidate?: { kind: Kind; parent?: Parent }[];
  /**
   * Objects the write deleted: their cached item is dropped (before the reloads), so a page that opens
   * one again asks APISIX and says "not found" (or, for plugin metadata, opens the create form) rather
   * than showing what was cached of it. A consumer's credentials go with it (APISIX deletes them with
   * the consumer, admin/resource.lua 373–378): its credentials' cached items and list are dropped too.
   */
  forget?: { kind: Kind; id: string; parent?: Parent }[];
  /** Toasted after a success. */
  success?: string;
  /** No error toast; the caller shows the error itself. */
  silent?: boolean;
}

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError('http', err instanceof Error ? err.message : String(err), { cause: err });
}

/**
 * Every write in the app goes through this (the editor's save included). It runs `action` with the
 * active client and never throws. On success it reloads the `invalidate` lists (waiting for them),
 * then toasts `success`. On failure it toasts APISIX's message (unless `silent`); an auth failure (a
 * viewer key writing) marks the connection read-only and stays on the page. The one rule of the write
 * path: once the connection is known read-only, `action` is not run at all, so nothing is sent
 * (another GET and PUT, a second DELETE): the refusal comes back at once, an `auth` error saying so.
 */
export function useWrite(): <T>(action: (client: AdminClient) => Promise<T>, opts?: WriteOptions) => Promise<WriteResult<T>> {
  const client = useClient();
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  return useCallback(
    async <T>(action: (client: AdminClient) => Promise<T>, opts: WriteOptions = {}): Promise<WriteResult<T>> => {
      if (readOnly.has(client.conn.id)) {
        const error = new ApiError('auth', t('readOnly.refused'));
        if (!opts.silent) toast.error(error.message);
        return { ok: false, error };
      }
      let value: T;
      try {
        value = await action(client);
      } catch (err) {
        const error = asApiError(err);
        if (error.kind === 'auth') markReadOnly(client.conn.id);
        if (!opts.silent) toast.error(error.errorMsg ?? error.message);
        return { ok: false, error };
      }
      for (const { kind, id, parent } of opts.forget ?? []) {
        queryClient.removeQueries({ queryKey: scopedKey(client.conn.id, queryKeys.item(kind, id, parent)), exact: true });
        // [credentials, <username>] is the prefix of that consumer's credential items and list (queryKeys).
        if (kind === 'consumers') queryClient.removeQueries({ queryKey: scopedKey(client.conn.id, ['credentials', id]) });
      }
      await Promise.all((opts.invalidate ?? []).map(({ kind, parent }) => invalidate(kind, parent)));
      if (opts.success) toast.success(opts.success);
      return { ok: true, value };
    },
    [client, invalidate, queryClient],
  );
}
