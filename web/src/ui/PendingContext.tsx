import { createContext, use, useId, useLayoutEffect, useMemo, useRef, type FC, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { t } from '../i18n';
import { toast } from './toast';

/** Input a component holds that is NOT in the value it emitted, as the provider's owner sees it. */
export interface PendingEntry {
  id: string;
  message: string;
}

interface PendingRegistry {
  set(id: string, message: string | undefined): void;
}

const PendingContext = createContext<PendingRegistry | null>(null);

/** The provider's registry: entries by id, reported to `onChange`, and passed on to `parent` when there is one. */
function Registry({ onChange, parent, children }: { onChange: (entries: PendingEntry[]) => void; parent: PendingRegistry | null; children: ReactNode }) {
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
        // The provider above hears of every change, also while this one unmounts (its entries go then).
        parent?.set(id, message);
        const map = entries.current;
        if (message === undefined ? !map.delete(id) : map.get(id) === message) return;
        if (message !== undefined) map.set(id, message);
        if (alive.current) report();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report reads refs only; a provider keeps its parent
    [],
  );
  return <PendingContext value={registry}>{children}</PendingContext>;
}

/**
 * Collects what the components below it hold but have not emitted (usePending), and hands the whole
 * list to `onChange` whenever it changes: an editor blocks Save while the list isn't empty, since
 * what a field shows must be what gets saved. It is a boundary: a provider above hears nothing of
 * these entries (a dialog's form answers for itself).
 */
export const PendingProvider: FC<{ onChange: (entries: PendingEntry[]) => void; children: ReactNode }> = ({ onChange, children }) => (
  <Registry onChange={onChange} parent={null}>
    {children}
  </Registry>
);

/**
 * A part of a form that can hide or swap its fields (a collapsible card or group, a Form/JSON
 * switch): what the fields inside hold still reaches the provider above, and `onChange` tells the
 * part, so it can refuse to hide them rather than drop it (see useHeld).
 */
export const PendingScope: FC<{ onChange: (entries: PendingEntry[]) => void; children: ReactNode }> = ({ onChange, children }) => {
  const parent = use(PendingContext);
  return (
    <Registry onChange={onChange} parent={parent}>
      {children}
    </Registry>
  );
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

/** Set while one refusal is being told: a tab strip asks twice per click (mousedown, then focus). */
let refusing = false;

export interface Held {
  /** PendingScope's onChange: what the fields inside hold now. */
  track: (entries: PendingEntry[]) => void;
  /**
   * Ask before hiding or swapping the fields (from an event handler): while one of them holds input,
   * this says so (a toast with its message), moves focus to the first flagged field in `container`
   * and returns true, and the part stays as it is. Returns false when nothing is held. What a field
   * left by this very click committed on blur is rendered first (a tab strip focuses its tab before
   * it asks), so text refused then counts.
   */
  refuse: (container: HTMLElement | null) => boolean;
}

/** What a part that can hide its fields needs: wrap them in <PendingScope onChange={held.track}>, and ask held.refuse first. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs beside the scope it serves
export function useHeld(): Held {
  const entries = useRef<PendingEntry[]>([]);
  return useMemo<Held>(
    () => ({
      track: (next) => {
        entries.current = next;
      },
      refuse(container) {
        flushSync(() => {});
        const first = entries.current[0];
        if (!first) return false;
        container?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        if (!refusing) {
          refusing = true;
          setTimeout(() => {
            refusing = false;
          });
          toast.error(t('ui.pending.refused', { message: first.message }));
        }
        return true;
      },
    }),
    [],
  );
}
