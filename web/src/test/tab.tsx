// Renders one editor tab the way the frame does: controlled (the draft replaced by each setDraft),
// issues from the kind's own check, inside a LockProvider and a PendingProvider, on a fake Admin API
// (the Plugins tab asks it for plugins?all=true, a stream route's for &subsystem=stream).
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { vi, type Mock } from 'vitest';
import type { Item, Kind, Obj } from '../api/types';
import type { Issue } from '../editor/issues';
import type { Ctx } from '../resources/ctx';
import type { TabProps, ValidateEnv } from '../resources/registry';
import { LockProvider, PendingProvider, type PendingEntry } from '../ui';
import { ctxOf } from './ctx';
import type { FakeAdminOptions } from './fakeAdmin';
import { pluginReplies } from './plugins';
import { renderWithProviders } from './providers';

export interface TabOptions {
  locked?: boolean;
  isNew?: boolean;
  ctx?: Ctx;
  /** Issues to pass instead of the kind's own (`validate`). */
  issues?: Issue[];
  /** The stored object as loaded, for tabs that read its id. */
  original?: Item;
  /** Where the harness's router starts (the tab may link elsewhere). */
  path?: string;
  admin?: FakeAdminOptions;
}

export function renderTab(
  kind: Kind,
  Tab: ComponentType<TabProps>,
  initial: Obj,
  validate: (draft: Obj, env: ValidateEnv) => Issue[],
  opts: TabOptions = {},
) {
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
    const issues = useMemo(() => opts.issues ?? validate(draft, { isNew: opts.isNew ?? false, ctx, original: opts.original }), [draft]);
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
            kind={kind}
            isNew={opts.isNew ?? false}
            ctx={ctx}
            issues={issues}
            original={opts.original}
            saveAttempts={0}
          />
        </LockProvider>
      </PendingProvider>
    );
  }

  const user = userEvent.setup();
  const result = renderWithProviders(<Harness />, { path: opts.path, ...opts.admin, replies: { ...pluginReplies(), ...opts.admin?.replies } });
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
