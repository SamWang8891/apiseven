import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';

/**
 * Save as the button and Cmd/Ctrl-S ask for it: the focused field in `body` is left first, and what
 * that writes (a field that commits on blur) is rendered at once (flushSync), so the save that runs
 * is the latest render's and sees it, pending input included (usePending registers in layout
 * effects). The field is handed to `save`, which gives it its focus back when it refuses.
 */
export function useSaveRequest(
  body: RefObject<HTMLElement | null>,
  save: (force: boolean, left?: HTMLElement) => Promise<void>,
  enabled: boolean,
): (force?: boolean) => void {
  const latest = useRef(save);
  useLayoutEffect(() => {
    latest.current = save;
  });
  return (force = false) => {
    if (!enabled) return;
    const focused = document.activeElement;
    const left = focused instanceof HTMLElement && body.current?.contains(focused) ? focused : undefined;
    if (left) flushSync(() => left.blur());
    void latest.current(force, left);
  };
}
