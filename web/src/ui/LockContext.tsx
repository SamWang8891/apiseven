import { createContext, use, type FC, type ReactNode } from 'react';

const LockContext = createContext(false);

/** Puts every input below it into the locked (read-only, full-contrast) state, or takes it out. */
export const LockProvider: FC<{ locked: boolean; children: ReactNode }> = ({ locked, children }) => (
  <LockContext value={locked}>{children}</LockContext>
);

/** True inside a locked LockProvider; false outside any provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the pinned API puts the hook beside its provider
export function useLocked(): boolean {
  return use(LockContext);
}
