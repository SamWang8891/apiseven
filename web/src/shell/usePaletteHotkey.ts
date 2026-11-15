import { useEffect, useRef } from 'react';

/** macOS (and iOS): the palette's shortcut is ⌘K there, Ctrl-K elsewhere. */
export function isMac(): boolean {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The modifier of the palette's shortcuts held, on this platform (⌘ on macOS, Ctrl elsewhere). */
export const modHeld = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (isMac() ? e.metaKey : e.ctrlKey);

/** Where "/" is a character: a text field, a select, an editable element (the code editor). */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="textbox"], [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * The palette's global keys. Cmd/Ctrl-K toggles it from anywhere, focus in a field or the code
 * editor included: it is caught before anything below the window sees it, and the browser's own use
 * of it is prevented. "/" opens it when focus is not in an editable element and nothing else took the
 * key first (a list page's "/" focuses that list's search box, as its hint says).
 */
export function usePaletteHotkey(toggle: () => void, open: () => void): void {
  const handlers = useRef({ toggle, open });
  useEffect(() => {
    handlers.current = { toggle, open };
  });
  useEffect(() => {
    const onCapture = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k' || !modHeld(e)) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.current.toggle();
    };
    const onBubble = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || editable(e.target)) return;
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
