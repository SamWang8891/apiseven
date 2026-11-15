// The frame's one way for a tab to change the draft (Editor.tsx `edit`). It reads whether the draft may
// change at the time of the call, not when the callback was made: a callback from before a save or a
// lock (a file read that finishes late, any component's stale closure) writes nothing while either
// lasts (Task 16b, fix round 1, R3.2). `stop` closes it at once, before the next render says so.
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Obj } from '../api/types';

export function useEdit(editable: boolean, write: (next: Obj) => void): { edit: (next: Obj) => void; stop: () => void } {
  const now = useRef({ editable, write });
  useLayoutEffect(() => {
    now.current = { editable, write };
  });
  const edit = useCallback((next: Obj) => {
    if (now.current.editable) now.current.write(next);
  }, []);
  const stop = useCallback(() => {
    now.current = { ...now.current, editable: false };
  }, []);
  return { edit, stop };
}
