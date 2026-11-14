import { useCallback, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { PendingEntry } from '../ui';
import { JSON_TAB } from './json';
import { useTabParam } from './useTabParam';

export interface ActiveTab {
  /** The tab shown: `?tab=` when it names one of `tabIds`, else the first. */
  active: string;
  /** What the active tab's fields hold that is not in the draft (usePending): Save waits for it. */
  pending: PendingEntry[];
  /** The PendingProvider's onChange. */
  onPending: (entries: PendingEntry[]) => void;
  /** Forgets the entries, for a tab area being remounted (Discard). */
  dropPending: () => void;
  /** Shows `tab`, through the URL; the leave guard lets this change pass (see holdsTab). */
  goTab: (tab: string) => void;
  /** A tab the user chose: once the field being typed in is left, asked about while the active tab holds input. */
  chooseTab: (tab: string) => void;
  /** A chosen tab waiting for "Discard and switch" or "Stay". */
  asking: boolean;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
  /**
   * Leaves the field being typed in on the active tab (if focus is still there), and renders what it
   * commits on blur at once (flushSync), so the decision made next sees it: tag text typed without
   * Enter is added, and what is still held (refused tag text) is in the entries.
   */
  leaveField: () => void;
  /** For the leave guard: whether a URL change to `?tab=<tab>` must ask first (the active tab holds input). */
  holdsTab: (tab: string | null) => boolean;
}

/** The editor's active tab, and the switches away from it that would drop input a field holds. */
export function useActiveTab(tabIds: string[], body: RefObject<HTMLElement | null>): ActiveTab {
  const [requested, setTab] = useTabParam();
  const tabOf = (tab: string | null): string => (tab !== null && tabIds.includes(tab) ? tab : (tabIds[0] ?? JSON_TAB));
  const active = tabOf(requested);

  const [pending, setPending] = useState<PendingEntry[]>([]);
  // The same, as of the last commit: read by decisions made right after the focused field is left.
  const pendingRef = useRef<PendingEntry[]>([]);
  const onPending = useCallback((entries: PendingEntry[]) => {
    pendingRef.current = entries;
    setPending(entries);
  }, []);
  const dropPending = useCallback(() => onPending([]), [onPending]);

  const [switchTo, setSwitchTo] = useState<string>();
  /** The tab being written to the URL by goTab, which the leave guard lets pass. */
  const writing = useRef<string>(undefined);

  const leaveField = useCallback(() => {
    const focused = document.activeElement;
    // Radix renders a (hidden, empty) panel for every tab: the shown one is the active one.
    const panel = body.current?.querySelector('[role="tabpanel"]:not([hidden])');
    // Flushed even when focus has already moved: a click on a tab focuses it before the tab change
    // arrives, and what the field left then committed (or refused) must be rendered first.
    flushSync(() => {
      if (focused instanceof HTMLElement && panel?.contains(focused)) focused.blur();
    });
  }, [body]);

  function goTab(tab: string) {
    writing.current = tab;
    setTab(tab);
    writing.current = undefined;
  }

  function chooseTab(next: string) {
    if (next === active) return;
    leaveField();
    if (pendingRef.current.length > 0) setSwitchTo(next);
    else goTab(next);
  }

  return {
    active,
    pending,
    onPending,
    dropPending,
    goTab,
    chooseTab,
    asking: switchTo !== undefined,
    confirmSwitch: () => {
      if (switchTo !== undefined) goTab(switchTo);
      setSwitchTo(undefined);
    },
    cancelSwitch: () => setSwitchTo(undefined),
    leaveField,
    holdsTab: (tab) => tab !== writing.current && tabOf(tab) !== active && pendingRef.current.length > 0,
  };
}
