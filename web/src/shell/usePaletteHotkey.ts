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

/** Open overlays own the keyboard (as editor/useEditorKeys.ts has it): a dialog, a menu, a listbox. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether an overlay is open anywhere on the page, wherever focus is (it may be on the page's body). */
export const overlayOpen = (): boolean => document.querySelector(OVERLAY) !== null;

/**
 * The palette's global keys. Cmd/Ctrl-K toggles it from anywhere, focus in a field or the code
 * editor included: it is caught before anything below the window sees it, and the browser's own use
 * of it is prevented. "/" opens it when focus is not in an editable element and nothing else took the
 * key first (a list page's "/" focuses that list's search box, as its hint says). While another
 * overlay is open (a dialog, a menu, a select's list), neither key does anything: that overlay owns
 * the keyboard. `isOpen` says whether the palette itself is the one open.
 */
export function usePaletteHotkey(toggle: () => void, open: () => void, isOpen: () => boolean): void {
  const handlers = useRef({ toggle, open, isOpen });
  useEffect(() => {
    handlers.current = { toggle, open, isOpen };
  });
  useEffect(() => {
    const onCapture = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.shiftKey || !isK(e) || !modHeld(e)) return;
      if (!handlers.current.isOpen() && overlayOpen()) return;
      e.preventDefault();
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
