import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isObj } from '../api/sanitize';
import { useConnections } from '../connection/store';
import { overlayOpen, usePaletteHotkey } from './usePaletteHotkey';

/** How the palette was left: 'dismiss' (Esc, a theme, a new tab) gives focus back; 'navigate' leaves it to the page opened. */
export type PaletteExit = 'dismiss' | 'navigate';

const SWITCH = 'apiseven.switchConnection';

/**
 * The router state of a navigation that switches to connection `id` once it is through: a leave
 * guard that holds the navigation holds the switch with it, and Stay cancels both.
 */
export const switchState = (id: string): Record<string, string> => ({ [SWITCH]: id });

const switchTarget = (state: unknown): string | undefined => (isObj(state) && typeof state[SWITCH] === 'string' ? state[SWITCH] : undefined);

/**
 * The palette's host, in the shell: whether it is open (Cmd/Ctrl-K, "/", the header button), where
 * focus goes when it closes (back to where it was; after a navigation, to `main` when the page left
 * it nowhere), and the connection switch a palette navigation asked for.
 */
export function usePalette(main: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const after = useRef<'restore' | 'page' | undefined>(undefined);

  const show = useCallback(() => {
    // Never over another overlay: it owns the keyboard, and a result chosen here would unmount it.
    if (shown.current || overlayOpen()) return;
    shown.current = true;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    after.current = undefined;
    setOpen(true);
  }, []);

  const close = useCallback((how: PaletteExit) => {
    if (!shown.current) return;
    shown.current = false;
    after.current = how === 'dismiss' ? 'restore' : 'page';
    setOpen(false);
  }, []);

  const toggle = useCallback(() => (shown.current ? close('dismiss') : show()), [close, show]);
  const isOpen = useCallback(() => shown.current, []);
  usePaletteHotkey(toggle, show, isOpen);

  // Closed without leaving: focus goes back where it was (the kit Dialog has no trigger to return to).
  useEffect(() => {
    if (open || after.current !== 'restore') return;
    after.current = undefined;
    const el = returnTo.current;
    if (el?.isConnected && nothingFocused()) el.focus();
  }, [open]);

  // A palette navigation went through: the page it opened takes focus, unless something on it has.
  const location = useLocation();
  useEffect(() => {
    if (after.current !== 'page') return;
    after.current = undefined;
    if (nothingFocused()) main.current?.focus({ preventScroll: true });
  }, [location.key, main]);

  // A connection switch rides on its navigation (switchState): done once that navigation is through.
  const navigate = useNavigate();
  const { setActive } = useConnections();
  const target = switchTarget(location.state);
  useEffect(() => {
    if (target === undefined) return;
    void navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    setActive(target);
  }, [target, location.pathname, location.search, navigate, setActive]);

  return { open, show, close };
}

const nothingFocused = (): boolean => document.activeElement === null || document.activeElement === document.body;
