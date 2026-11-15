import { createContext, use, useMemo, useState, type Dispatch, type FC, type ReactNode, type SetStateAction } from 'react';

interface Lock {
  locked: boolean;
  /** Changes each time editing ends (see LockProvider's `session`); undefined when the owner has none. */
  session?: number;
  /** Locked only because a save is in flight: still the editing session, inert meanwhile. */
  busy?: boolean;
}

const LockContext = createContext<Lock>({ locked: false });

/**
 * Puts every input below it into the locked (read-only, full-contrast) state, or takes it out.
 * `session`, when the owner has one (the editor bumps it on Save, Discard and every other lock),
 * marks the end of an editing session: state kept with useEditingState starts over then. A lock that
 * is not the end of one (a save in flight) leaves it alone. A provider inside another one, without a
 * session of its own, is part of the outer one's.
 */
export const LockProvider: FC<{ locked: boolean; session?: number; busy?: boolean; children: ReactNode }> = ({ locked, session, busy, children }) => {
  const outer = use(LockContext);
  const value = useMemo(() => ({ locked, session: session ?? outer.session, busy: busy ?? outer.busy }), [locked, session, busy, outer.session, outer.busy]);
  return <LockContext value={value}>{children}</LockContext>;
};

/**
 * True while the lock is only a save in flight (the editor's `busy`): a field that shows something
 * of its own editing session keeps showing it then, inert, rather than its locked view.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook of the lock, beside it
export function useBusy(): boolean {
  const { locked, busy } = use(LockContext);
  return locked && busy === true;
}

/** True inside a locked LockProvider; false outside any provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the pinned API puts the hook beside its provider
export function useLocked(): boolean {
  return use(LockContext).locked;
}

const initialOf = <T,>(initial: T | (() => T)): T => (typeof initial === 'function' ? (initial as () => T)() : initial);

/** useState that starts over (from `initial`, as of this render) each time `key` changes. */
function useStateUntil<T>(initial: T | (() => T), key: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(initial);
  const [seen, setSeen] = useState(key);
  if (!Object.is(seen, key)) {
    setSeen(key);
    const fresh = initialOf(initial);
    setState(fresh);
    return [fresh, setState];
  }
  return [state, setState];
}

/**
 * useState for what belongs to one editing session (a key replacement in progress, rows being
 * typed, text not yet added): it goes back to `initial` when editing ends, so none of it shows in
 * the locked view or comes back on the next Edit. Editing ends when the provider's session changes
 * (the editor's Save, Discard); under a provider without a session, whenever it locks or unlocks.
 * `initial` may be a function, called with the current render's values when it starts over.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook of the lock, beside it
export function useEditingState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { locked, session } = use(LockContext);
  return useStateUntil(initial, session ?? locked);
}

/**
 * What identifies the current editing session below a LockProvider: its `session` when the owner has
 * one, else whether it is locked (as useEditingState starts over). For state that must also outlive a
 * remount inside the session (useSessionViewState).
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook of the lock, beside it
export function useSessionKey(): string {
  const { locked, session } = use(LockContext);
  return session === undefined ? `locked:${String(locked)}` : `session:${session}`;
}

/**
 * Whether a secret is shown: hidden again whenever the field locks or unlocks (a save in flight
 * included), so a secret revealed while editing never stays readable in the locked view.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook of the lock, beside it
export function useReveal(): [boolean, Dispatch<SetStateAction<boolean>>] {
  return useStateUntil(false, use(LockContext).locked);
}
