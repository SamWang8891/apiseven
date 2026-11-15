// View state that must outlive a remount inside one editor page: a choice the draft can't express yet
// (a target mode before anything is typed), and, for the page's tabs, what is open and which view is
// shown. A tab switch, a collapse or a Form/JSON toggle unmounts the parts that hold it. The editor
// frame keeps one memory for the page's life (nothing is persisted); without one, it is plain state.
import { createContext, use, useCallback, useState, type Dispatch, type FC, type ReactNode, type SetStateAction } from 'react';

const ViewMemoryContext = createContext<Map<string, unknown> | null>(null);

/** One memory for everything below it, kept as long as it is mounted (the editor frame: the page). */
export const ViewMemory: FC<{ children: ReactNode }> = ({ children }) => {
  const [memory] = useState(() => new Map<string, unknown>());
  return <ViewMemoryContext value={memory}>{children}</ViewMemoryContext>;
};

/**
 * useState for view state that a remount must not reset: what was set is remembered under `key`
 * (unique on the page) and is where the state starts when the component mounts again; until then it
 * starts from `initial`. Only what is set is remembered, so an `initial` that depends on the moment
 * (a section open because it has problems) is worked out afresh. No `key`: plain state.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs beside its provider, as useLocked does
export function useViewState<T>(key: string | undefined, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const page = use(ViewMemoryContext);
  const memory = key === undefined ? null : page;
  const [state, setState] = useState<T>(() => (key !== undefined && memory?.has(key) ? (memory.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial));
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setState((prev) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        // Idempotent, so a second call of this updater (StrictMode) changes nothing.
        if (key !== undefined) memory?.set(key, value);
        return value;
      }),
    [memory, key],
  );
  return [state, set];
}
