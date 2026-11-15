import { createContext, use, useId, useLayoutEffect, useMemo, useRef, type FC, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { t } from '../i18n';
import { toast } from './toast';

/** Input a component holds that is NOT in the value it emitted, as the provider's owner sees it. */
export interface PendingEntry {
  id: string;
  message: string;
  /**
   * The text control that was focused when the component began to hold, or last changed what it
   * holds: the field being typed in. Where a refusal puts focus (heldField).
   */
  element?: HTMLElement;
}

interface PendingRegistry {
  set(id: string, message: string | undefined, element?: HTMLElement): void;
}

const PendingContext = createContext<PendingRegistry | null>(null);

/** The provider's registry: entries by id, reported to `onChange`, and passed on to `parent` when there is one. */
function Registry({ onChange, parent, children }: { onChange: (entries: PendingEntry[]) => void; parent: PendingRegistry | null; children: ReactNode }) {
  const entries = useRef(new Map<string, { message: string; element?: HTMLElement }>());
  const latest = useRef(onChange);
  const alive = useRef(false);
  useLayoutEffect(() => {
    latest.current = onChange;
  });
  const report = () => latest.current([...entries.current].map(([id, entry]) => ({ id, ...entry })));
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
      set(id, message, element) {
        // The provider above hears of every change, also while this one unmounts (its entries go then).
        parent?.set(id, message, element);
        const map = entries.current;
        const had = map.get(id);
        if (message === undefined ? !map.delete(id) : had?.message === message) return;
        // A change made while no text control has focus (a blur, a change from outside) keeps the field it had.
        if (message !== undefined) map.set(id, { message, element: element ?? had?.element });
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
 *
 * The rule the callers keep: a held entry goes only when the user fixed the text, cleared it, or
 * confirmed a discard (Discard, "Discard and switch", removing its row or plugin). Nothing else may
 * unmount a holder or make it read-only while it holds: parts that hide fields refuse (useHeld), and
 * a part made read-only because a sibling holds input is one that holds nothing itself (PluginCard).
 * The component must also stay bound to one field: in a list, key it by a row id that follows the
 * row, never by position.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs beside its provider, as useLocked does
export function usePending(message: string | undefined): void {
  const registry = use(PendingContext);
  const id = useId();
  // Layout effects, so the provider hears of a change in the same commit: a Save that first lets the
  // focused field commit on blur (inside flushSync) then sees what is still pending.
  useLayoutEffect(() => {
    registry?.set(id, message, message === undefined ? undefined : typingIn());
  }, [registry, id, message]);
  useLayoutEffect(() => () => registry?.set(id, undefined), [registry, id]);
}

/** The text control that has focus (an input, a textarea, CodeMirror's content), if one has: the field being typed in. */
function typingIn(): HTMLElement | undefined {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.matches('input, textarea, [contenteditable]:not([contenteditable="false"])') ? active : undefined;
}

/**
 * Where a refusal puts focus in `container`: the field that holds the entry's input (the one whose
 * message is told), else the first flagged field, which may be one with a validation problem.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a helper of the entries this module reports
export function heldField(entry: PendingEntry | undefined, container: HTMLElement | null | undefined): HTMLElement | undefined {
  const element = entry?.element;
  if (element?.isConnected && container?.contains(element)) return element;
  return container?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? undefined;
}

/** Set while one refusal is being told: a tab strip asks twice per click (mousedown, then focus). */
let refusing = false;

export interface Held {
  /** PendingScope's onChange: what the fields inside hold now. */
  track: (entries: PendingEntry[]) => void;
  /**
   * Ask before hiding or swapping the fields (from an event handler): while one of them holds input,
   * this says so (a toast with its message), moves focus to the field that holds it in `container`
   * (heldField) and returns true, and the part stays as it is. Returns false when nothing is held. What a field
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
        heldField(first, container)?.focus();
        if (!refusing) {
          refusing = true;
          setTimeout(() => {
            refusing = false;
          });
          toast.error(t('ui.pending.refused', { message: first.message }), { pageBound: true });
        }
        return true;
      },
    }),
    [],
  );
}
