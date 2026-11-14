// Renders the Plugins tab the way the editor frame does: controlled (the value replaced by every
// change), issues from pluginIssues against the 3.20 fixture, inside a LockProvider, on a fake
// Admin API that answers plugins?all=true (and &subsystem=stream) from the fixture.
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useMemo, useState } from 'react';
import { vi, type Mock } from 'vitest';
import type { Obj } from '../api/types';
import { PluginsTab, type PluginsTabProps } from '../plugins/PluginsTab';
import type { Scope } from '../plugins/scope';
import { pluginIssues } from '../plugins/validate';
import { LockProvider } from '../ui';
import { ctxOf } from './ctx';
import { json, type FakeAdminOptions } from './fakeAdmin';
import { pluginFixture } from './pluginFixture';
import { renderWithProviders } from './providers';

/** Fake Admin API replies for plugins?all=true: the fixture's http set, or its stream set with subsystem=stream. */
export function pluginReplies(): NonNullable<FakeAdminOptions['replies']> {
  return {
    plugins: (req) => json(200, req.url.searchParams.get('subsystem') === 'stream' ? pluginFixture().stream : pluginFixture().http),
  };
}

type Plugins = Record<string, Obj> | undefined;

interface Options {
  scope: Scope;
  value?: Plugins;
  locked?: boolean;
  inherited?: PluginsTabProps['inherited'];
  saveAttempts?: number;
  /** Extra issues, as the frame passes APISIX's error (e.g. at `plugins.<name>`). */
  extraIssues?: PluginsTabProps['issues'];
  /** Leave out the pluginIssues checks (default: on). */
  validate?: boolean;
  /** Fake Admin API options (e.g. replies that fail plugins?all=true). */
  admin?: FakeAdminOptions;
}

type Live = Pick<Options, 'locked' | 'saveAttempts' | 'extraIssues'>;

export function renderPluginsTab(opts: Options) {
  const changes: Mock<(v: Plugins) => void> = vi.fn();
  let current = opts.value;
  const control: { set?: (p: Live) => void } = {};
  const env = { isNew: false, ctx: ctxOf(), plugins: pluginFixture().http, streamPlugins: pluginFixture().stream };

  function Harness() {
    const [value, setValue] = useState<Plugins>(opts.value);
    const [live, setLive] = useState<Live>({ locked: opts.locked, saveAttempts: opts.saveAttempts, extraIssues: opts.extraIssues });
    useEffect(() => {
      control.set = (p) => setLive((prev) => ({ ...prev, ...p }));
    }, []);
    const issues = useMemo(
      () => [...(opts.validate === false ? [] : pluginIssues({ plugins: value }, env, opts.scope)), ...(live.extraIssues ?? [])],
      [value, live.extraIssues],
    );
    return (
      <LockProvider locked={live.locked ?? false}>
        <PluginsTab
          value={value}
          onChange={(v) => {
            current = v;
            changes(v);
            setValue(v);
          }}
          scope={opts.scope}
          issues={issues}
          inherited={opts.inherited}
          saveAttempts={live.saveAttempts}
        />
      </LockProvider>
    );
  }

  const user = userEvent.setup();
  const result = renderWithProviders(<Harness />, { ...opts.admin, replies: { ...pluginReplies(), ...opts.admin?.replies } });
  return {
    ...result,
    user,
    changes,
    /** The value now (the initial one until something is emitted). */
    value: () => current,
    /** Changes the lock, the save-attempt count or the extra issues, keeping the value. */
    update: (p: Live) => act(() => control.set?.(p)),
  };
}
