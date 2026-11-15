import { useEffect, useSyncExternalStore } from 'react';
import type { ApiError } from './errors';

// Whether each connection's Admin API answers, judged from real responses only (AdminClient.request
// reports every one): a request that got no answer at all (ApiError kind `network`) marks it
// unreachable; any answer after that (data, or an HTTP error such as 401, 404 or 500, or a body that is
// not the Admin API's) proves it reachable again. Data the app writes into the cache itself
// (setQueryData) is no answer, so it changes nothing here.

interface Reach {
  /** Order of the newest request that got no answer (0: none), and its error. */
  failed: number;
  error?: ApiError;
  /** Order of the newest request that got an answer of any kind. */
  answered: number;
}

let order = 0;
const reach = new Map<string, Reach>();
const listeners = new Set<() => void>();
/** Pages that already say, with their own retry, that a read got no answer (useOwnUnreachable). */
let claims = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function entry(connId: string): Reach {
  let r = reach.get(connId);
  if (!r) {
    r = { failed: 0, answered: 0 };
    reach.set(connId, r);
  }
  return r;
}

/** A response arrived from the Admin API (whatever its status). */
export function noteAnswered(connId: string): void {
  const r = entry(connId);
  const wasDown = r.failed > r.answered;
  r.answered = ++order;
  if (wasDown) emit();
}

/** A request to the Admin API got no response at all. */
export function noteUnreached(connId: string, error: ApiError): void {
  const r = entry(connId);
  r.failed = ++order;
  r.error = error;
  emit();
}

/** The newest no-answer error of a connection, unless an answer came after it. */
export function unreachableError(connId: string): ApiError | undefined {
  const r = reach.get(connId);
  return r && r.failed > r.answered ? r.error : undefined;
}

/** unreachableError, re-rendering as it changes. */
export function useUnreachable(connId: string): ApiError | undefined {
  return useSyncExternalStore(subscribe, () => unreachableError(connId));
}

/**
 * For a page state that shows a read's failure with its own retry (a list's or an editor's load
 * error): while it shows a no-answer error, the shell's banner stands down, so the page has one
 * message and one retry.
 */
export function useOwnUnreachable(error: ApiError | undefined): void {
  const own = error?.kind === 'network';
  useEffect(() => {
    if (!own) return;
    claims++;
    emit();
    return () => {
      claims = Math.max(0, claims - 1);
      emit();
    };
  }, [own]);
}

/** Whether a page state already shows a no-answer error itself. */
export function usePageOwnsUnreachable(): boolean {
  return useSyncExternalStore(subscribe, () => claims > 0);
}

/** Forgets everything. For tests. */
export function resetReachability(): void {
  reach.clear();
  claims = 0;
  emit();
}
