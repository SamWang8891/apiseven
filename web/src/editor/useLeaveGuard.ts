import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker, useLocation, type BlockerFunction, type Location } from 'react-router';

export interface LeaveGuard {
  /**
   * A navigation is waiting for the user's answer: 'leave' for another page (DiscardDialog), 'tab'
   * for another tab of this one, through the URL (Back, a link to `?tab=`), while the active tab
   * holds input (PendingDialog).
   */
  blocked: 'leave' | 'tab' | undefined;
  /** Let the waiting navigation go. */
  leave: () => void;
  /** Cancel the waiting navigation (the URL stays, or goes back to, where it was). */
  stay: () => void;
  /** Lift the guard for good, for the navigation that follows a create or a delete. */
  leaveFreely: () => void;
}

export interface LeaveGuardOptions {
  /** Runs before a navigation is judged: lets the focused field commit what it holds (blur), at once. */
  settle?: () => void;
  /** For a change of `?tab=` only: whether that tab change must ask first (the active tab holds input). */
  holdsTab?: (tab: string | null) => boolean;
}

const param = (location: Location, name: string): string | null => new URLSearchParams(location.search).get(name);

/** Another page: another path, or another `?from=` (the create page copying another object). */
const isLeaving = (from: Location, to: Location): boolean => from.pathname !== to.pathname || param(from, 'from') !== param(to, 'from');

/**
 * While `dirty`, holds navigation to another page of the app for the user to confirm, and has the
 * browser ask before the tab is closed or reloaded. A change of `?tab=` alone is not leaving: it is
 * held only when `holdsTab` says so. Before either is judged, `settle` lets the field being typed in
 * commit what it holds.
 */
export function useLeaveGuard(dirty: boolean, { settle, holdsTab }: LeaveGuardOptions = {}): LeaveGuard {
  const free = useRef(false);
  // Read when a navigation is judged, after `settle` re-rendered: the values of that render.
  const latest = useRef({ dirty, settle, holdsTab });
  useLayoutEffect(() => {
    latest.current = { dirty, settle, holdsTab };
  });
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (free.current) return false;
    const leaving = isLeaving(currentLocation, nextLocation);
    const tab = param(nextLocation, 'tab');
    if (!leaving && tab === param(currentLocation, 'tab')) return false;
    latest.current.settle?.();
    return leaving ? latest.current.dirty : (latest.current.holdsTab?.(tab) ?? false);
  }, []);
  const blocker = useBlocker(shouldBlock);
  const location = useLocation();

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!free.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const leaveFreely = useCallback(() => {
    free.current = true;
  }, []);

  return {
    blocked: blocker.state === 'blocked' ? (isLeaving(location, blocker.location) ? 'leave' : 'tab') : undefined,
    leave: () => blocker.proceed?.(),
    stay: () => blocker.reset?.(),
    leaveFreely,
  };
}
