// View state that must outlive a remount inside one editor page: a choice the draft can't express yet
// (a target mode before anything is typed), and, for the page's tabs, what is open and which view is
// shown. A tab switch, a collapse or a Form/JSON toggle unmounts the parts that hold it. The editor
// frame keeps one memory for the page's life (nothing is persisted); without one, it is plain state.
import { createContext, use, useCallback, useLayoutEffect, useState, type Dispatch, type FC, type ReactNode, type SetStateAction } from 'react';
import { useSessionKey } from './LockContext';

const ViewMemoryContext = createContext<Map<string, unknown> | null>(null);
/** The part of the page (an editor tab) the keys below belong to, so one title on two tabs is two keys. */
const ViewScopeContext = createContext('');

/** Names the part of the page its view state belongs to (the editor wraps each tab's content in one). */
export const ViewScope: FC<{ name: string; children: ReactNode }> = ({ name, children }) => {
  const outer = use(ViewScopeContext);
  return <ViewScopeContext value={outer ? `${outer}/${name}` : name}>{children}</ViewScopeContext>;
};

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
export function useViewState<T>(name: string | undefined, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const page = use(ViewMemoryContext);
  const scope = use(ViewScopeContext);
  const key = name === undefined ? undefined : scope ? `${scope}:${name}` : name;
  const memory = key === undefined ? null : page;
  /** The value, and whether it was set (only a set value is remembered). */
  const [cell, setCell] = useState<{ value: T; set: boolean }>(() =>
    key !== undefined && memory?.has(key) ? { value: memory.get(key) as T, set: true } : { value: typeof initial === 'function' ? (initial as () => T)() : initial, set: false },
  );
  // Remembered from the commit: a render React throws away never reaches the memory.
  useLayoutEffect(() => {
    if (cell.set && key !== undefined) memory?.set(key, cell.value);
  }, [cell, key, memory]);
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => setCell((prev) => ({ value: typeof next === 'function' ? (next as (p: T) => T)(prev.value) : next, set: true })),
    [],
  );
  return [cell.value, set];
}

/**
 * useViewState for a choice that decides what a form shows or writes but the draft can't hold yet (a
 * target mode chosen before anything is typed): editing state, kept through a remount (a tab switch)
 * within one editing session, and started over when the session ends (a save, Discard, any lock).
 * Callers never consult it while locked: the locked view states what is stored.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook beside useViewState
export function useSessionViewState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  return useViewState(`${key}@${useSessionKey()}`, initial);
}
