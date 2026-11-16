import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { placeOf, type Place } from './focusBack';

/**
 * Save as the button and Cmd/Ctrl-S ask for it: the focused field in `body` is left first, and what
 * that writes (a field that commits on blur) is rendered at once (flushSync), so the save that runs
 * is the latest render's and sees it, pending input included (usePending registers in layout
 * effects). The field is handed to `save`, which gives it its focus back when it refuses; so is the
 * control that had focus when the save was asked for anywhere else (Save, Save anyway, a dialog's
 * button), for the same purpose (focusBack.ts returnFocus). `anyway` is Save anyway (SaveAnyway.tsx),
 * judged by `save` like the rest after the field is left.
 */
/** Where a save came from: the field it left (and that field's place), else the control pressed. */
export interface SaveFrom {
  left?: HTMLElement;
  place?: Place;
  pressed?: HTMLElement;
}

export function useSaveRequest(
  body: RefObject<HTMLElement | null>,
  save: (force: boolean, left?: HTMLElement, anyway?: boolean, pressed?: HTMLElement, place?: Place) => Promise<void>,
  enabled: boolean,
): (force?: boolean, anyway?: boolean, from?: SaveFrom) => void {
  const latest = useRef(save);
  useLayoutEffect(() => {
    latest.current = save;
  });
  return (force = false, anyway = false, from?: SaveFrom) => {
    if (!enabled) return;
    // A save that goes on from an earlier one (Overwrite, after a conflict) keeps where that one came
    // from: what has focus now is the dialog's button, which goes with the dialog.
    if (from) {
      void latest.current(force, from.left, anyway, from.pressed, from.place);
      return;
    }
    const focused = document.activeElement;
    const left = focused instanceof HTMLElement && body.current?.contains(focused) ? focused : undefined;
    const pressed = !left && focused instanceof HTMLElement && focused !== document.body ? focused : undefined;
    // Where the field is, taken before the blur: the saving state may remount it (F3).
    const place = left ? placeOf(left) : undefined;
    if (left) flushSync(() => left.blur());
    void latest.current(force, left, anyway, pressed, place);
  };
}
