// Renders one tab of the route editor the way the frame does: controlled (the draft replaced by
// each setDraft), issues from routeIssues, inside a LockProvider and a PendingProvider, on a fake
// Admin API (the Plugins tab asks it for plugins?all=true).
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { vi, type Mock } from 'vitest';
import type { Obj } from '../api/types';
import type { Issue } from '../editor/issues';
import type { Ctx } from '../resources/ctx';
import type { TabProps } from '../resources/registry';
import { routeIssues } from '../resources/routes/validate';
import { LockProvider, PendingProvider, type PendingEntry } from '../ui';
import { ctxOf } from './ctx';
import type { FakeAdminOptions } from './fakeAdmin';
import { pluginReplies } from './plugins';
import { renderWithProviders } from './providers';

export interface RouteTabOptions {
  locked?: boolean;
  isNew?: boolean;
  ctx?: Ctx;
  /** Issues to pass instead of routeIssues' own. */
  issues?: Issue[];
  admin?: FakeAdminOptions;
}

export function renderRouteTab(Tab: ComponentType<TabProps>, initial: Obj, opts: RouteTabOptions = {}) {
  const changes: Mock<(v: Obj) => void> = vi.fn();
  let current = initial;
  let pending: PendingEntry[] = [];
  const ctx = opts.ctx ?? ctxOf();
  const control: { lock?: (locked: boolean) => void } = {};

  function Harness() {
    const [draft, setDraft] = useState(initial);
    const [locked, setLocked] = useState(opts.locked ?? false);
    useEffect(() => {
      control.lock = setLocked;
    }, []);
    const issues = useMemo(() => opts.issues ?? routeIssues(draft, { isNew: opts.isNew ?? false, ctx }), [draft]);
    return (
      <PendingProvider onChange={(entries) => (pending = entries)}>
        <LockProvider locked={locked}>
          <Tab
            draft={draft}
            setDraft={(next) => {
              if (locked) return;
              current = next;
              changes(next);
              setDraft(next);
            }}
            kind="routes"
            isNew={opts.isNew ?? false}
            ctx={ctx}
            issues={issues}
            saveAttempts={0}
          />
        </LockProvider>
      </PendingProvider>
    );
  }

  const user = userEvent.setup();
  const result = renderWithProviders(<Harness />, { ...opts.admin, replies: { ...pluginReplies(), ...opts.admin?.replies } });
  return {
    ...result,
    user,
    changes,
    /** The draft now (the initial one until a change). */
    value: () => current,
    /** What the tab's fields hold but have not emitted (usePending), as messages. */
    held: () => pending.map((entry) => entry.message),
    lock: (locked: boolean) => act(() => control.lock?.(locked)),
  };
}
