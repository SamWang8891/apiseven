import { useEffect, useRef } from 'react';

/** macOS (and iOS): the palette's shortcut is ⌘K there, Ctrl-K elsewhere. */
export function isMac(): boolean {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The modifier of the palette's shortcuts held, on this platform (⌘ on macOS, Ctrl elsewhere). */
export const modHeld = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (isMac() ? e.metaKey : e.ctrlKey);

/**
 * The K of Cmd/Ctrl-K: the key that types `k`, or the key in K's place when it types a letter of
 * another script (a Cyrillic layout). Not a key in K's place that types another Latin letter
 * (Dvorak's T): that is the user's own shortcut.
 */
const isK = (e: KeyboardEvent): boolean => e.key.toLowerCase() === 'k' || (e.code === 'KeyK' && !/^[a-z]$/i.test(e.key));

/** Where "/" is a character: a text field, a select, an editable element (the code editor). */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="textbox"], [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * The modal overlays of this app, which own the keyboard while open: the kit's dialogs (the plugin
 * picker among them), alert dialogs, menus, and popovers (the kit Select's list sits in one, a
 * `role="dialog"`). Not a bare listbox: CodeMirror draws its completions and its lint panel as one,
 * in the page, and neither is modal.
 */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** Whether a modal overlay is open anywhere on the page, wherever focus is (it may be on the page's body). */
export const overlayOpen = (): boolean => document.querySelector(OVERLAY) !== null;

/**
 * The palette's global keys. Cmd/Ctrl-K toggles it from anywhere, focus in a field or the code
 * editor included: it is caught before anything below the window sees it, and the browser's own use
 * of it is prevented. "/" opens it when focus is not in an editable element and nothing else took the
 * key first (a list page's "/" focuses that list's search box, as its hint says). While another
 * overlay is open (a dialog, a menu, a select's list), neither key does anything: that overlay owns
 * the keyboard (Cmd/Ctrl-K is still kept from the browser). `isOpen` says whether the palette itself
 * is the one open.
 */
export function usePaletteHotkey(toggle: () => void, open: () => void, isOpen: () => boolean): void {
  const handlers = useRef({ toggle, open, isOpen });
  useEffect(() => {
    handlers.current = { toggle, open, isOpen };
  });
  useEffect(() => {
    const onCapture = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.shiftKey || !isK(e) || !modHeld(e)) return;
      // The key never reaches the browser (its search or address bar), even when it does nothing here.
      e.preventDefault();
      if (!handlers.current.isOpen() && overlayOpen()) return;
      e.stopPropagation();
      handlers.current.toggle();
    };
    const onBubble = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || editable(e.target)) return;
      if (handlers.current.isOpen() || overlayOpen()) return;
      e.preventDefault();
      handlers.current.open();
    };
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onBubble);
    };
  }, []);
}
