// Where focus goes when a kit dialog closes (ConfirmDialog; Dialog since the final wave, O3). Neither
// has a trigger of its own: each is opened from a button, a menu item or a key. So each remembers
// where it was opened from as its focus moves in, and when it closes puts focus back there: on the
// menu's trigger when it came from a menu item (the item is gone), else on what had focus; never on
// `body`. Where the caller has already put focus on purpose (the field to fix, another dialog), it stays.
import { useRef } from 'react';

/** Where a dialog was opened from: what had focus, the trigger of the menu it was in, the table around it. */
interface Opener {
  element: Element | null;
  /** When `element` was a menu item: its menu's trigger (a row's ⋯, the editor's ⋯), which outlives the menu. */
  trigger: HTMLElement | null;
  /** The table the opener sat in, for when its row has gone (deleted). */
  table: HTMLElement | null;
}

function openedFrom(element: Element | null): Opener {
  const menu = element?.closest('[role="menu"]');
  // Radix labels a menu by its trigger, and the trigger names the menu it controls while it is open.
  const labelledBy = menu?.getAttribute('aria-labelledby');
  const byLabel = labelledBy ? document.getElementById(labelledBy) : null;
  const byControls = menu?.id ? ([...document.querySelectorAll<HTMLElement>('[aria-controls]')].find((el) => el.getAttribute('aria-controls') === menu.id) ?? null) : null;
  const trigger = menu ? (byLabel ?? byControls) : null;
  const table = (trigger ?? element)?.closest<HTMLElement>('table') ?? null;
  return { element, trigger, table };
}

const usable = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el !== document.body && !el.matches(':disabled');

/**
 * Focus back where the user was: the menu's trigger when the dialog came from a menu item (the item
 * is gone), else what had focus. A tab that is not the selected one would be switched to by taking
 * focus (Radix tabs activate on focus), which is what the dialog may have just declined (Stay): its
 * strip's selected tab takes focus instead. When that is gone (its row was deleted), the table's
 * first row action; then the page's `main`; then its heading (the Connect page has no `main`).
 */
function focusBack(opener: Opener | null) {
  const back = opener?.trigger ?? opener?.element;
  const tab = usable(back) && back.getAttribute('role') === 'tab' && back.getAttribute('aria-selected') !== 'true';
  const candidates = [
    tab ? back.closest('[role="tablist"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') : back,
    opener?.table?.isConnected ? opener.table.querySelector<HTMLElement>('.tbl-cell-actions button') : undefined,
    opener?.table ? document.querySelector<HTMLElement>('main h1[tabindex]') : undefined,
    document.querySelector<HTMLElement>('main'),
    document.querySelector<HTMLElement>('h1[tabindex]'),
  ];
  candidates.find(usable)?.focus({ preventScroll: true });
}

/** The Radix content handlers of a kit dialog: remember the opener as focus moves in; put focus back when it closes. */
export function useReturnFocus(): { onOpenAutoFocus: () => void; onCloseAutoFocus: (e: Event) => void } {
  const returnTo = useRef<Opener | null>(null);
  return {
    onOpenAutoFocus: () => {
      returnTo.current = openedFrom(document.activeElement);
    },
    onCloseAutoFocus: (e) => {
      e.preventDefault();
      const back = returnTo.current;
      returnTo.current = null;
      // Where the caller has already put focus (the field to fix, another dialog), it stays: the
      // dialog is gone by now, so focus on anything but body was put there on purpose.
      const now = document.activeElement;
      if (now instanceof HTMLElement && now !== document.body && now.isConnected) return;
      focusBack(back);
    },
  };
}
