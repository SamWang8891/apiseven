// Whether a component is still on the page, for work that finishes after an await (moved out of
// Editor.tsx unchanged).
import { useEffect, useRef, type RefObject } from 'react';

/** A ref that is true while the component is mounted and false once it is gone. */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
