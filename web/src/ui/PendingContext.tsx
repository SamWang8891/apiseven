import { createContext, use, useId, useLayoutEffect, useMemo, useRef, type FC, type ReactNode } from 'react';

/** Input a component holds that is NOT in the value it emitted, as the provider's owner sees it. */
export interface PendingEntry {
  id: string;
  message: string;
}

interface PendingRegistry {
  set(id: string, message: string | undefined): void;
}

const PendingContext = createContext<PendingRegistry | null>(null);

/**
 * Collects what the components below it hold but have not emitted (usePending), and hands the whole
 * list to `onChange` whenever it changes: an editor blocks Save while the list isn't empty, since
 * what a field shows must be what gets saved.
 */
export const PendingProvider: FC<{ onChange: (entries: PendingEntry[]) => void; children: ReactNode }> = ({ onChange, children }) => {
  const entries = useRef(new Map<string, string>());
  const latest = useRef(onChange);
  const alive = useRef(false);
  useLayoutEffect(() => {
    latest.current = onChange;
  });
  const report = () => latest.current([...entries.current].map(([id, message]) => ({ id, message })));
  // Children register before this runs on mount (theirs are deeper), so it reports what they hold
  // then. An unmounting provider tells no one: its owner is going too, or remounting it on purpose.
  useLayoutEffect(() => {
    alive.current = true;
    if (entries.current.size > 0) report();
    return () => {
      alive.current = false;
    };
  }, []);
  const registry = useMemo<PendingRegistry>(
    () => ({
      set(id, message) {
        const map = entries.current;
        if (message === undefined ? !map.delete(id) : map.get(id) === message) return;
        if (message !== undefined) map.set(id, message);
        if (alive.current) report();
      },
    }),
    [],
  );
  return <PendingContext value={registry}>{children}</PendingContext>;
};

/**
 * Declares input this component holds that is NOT in the value it emitted: a flagged duplicate,
 * text that doesn't parse, a row withheld until its key is valid. Pass a short message naming the
 * field and the problem (`Node 2: "10.0.0.1:80" is already in the list`) while that is the case,
 * and undefined otherwise. The entry follows the message and goes when the component unmounts.
 * Without a PendingProvider above, it does nothing.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs beside its provider, as useLocked does
export function usePending(message: string | undefined): void {
  const registry = use(PendingContext);
  const id = useId();
  // Layout effects, so the provider hears of a change in the same commit: a Save that first lets the
  // focused field commit on blur (inside flushSync) then sees what is still pending.
  useLayoutEffect(() => {
    registry?.set(id, message);
  }, [registry, id, message]);
  useLayoutEffect(() => () => registry?.set(id, undefined), [registry, id]);
}
