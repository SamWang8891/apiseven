import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router';

export interface LeaveGuard {
  /** A navigation is waiting for the user's answer (show DiscardDialog). */
  blocked: boolean;
  /** Let the waiting navigation go. */
  leave: () => void;
  /** Cancel the waiting navigation. */
  stay: () => void;
  /** Lift the guard for good, for the navigation that follows a create or a delete. */
  leaveFreely: () => void;
}

/**
 * While `dirty`, holds navigation to another page of the app for the user to confirm (tab and
 * search changes on the same page pass), and has the browser ask before the tab is closed or reloaded.
 */
export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const free = useRef(false);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirty && !free.current && currentLocation.pathname !== nextLocation.pathname,
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

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
    blocked: blocker.state === 'blocked',
    leave: () => blocker.proceed?.(),
    stay: () => blocker.reset?.(),
    leaveFreely,
  };
}
