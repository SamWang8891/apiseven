// Renders the upstream form the way an editor does: controlled, the value held by the caller and
// replaced by every emitted change. One section alone (as a standalone tab shows it) or the whole
// UpstreamForm. `changes` records each emitted value; `value()` is the current one.
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { vi, type Mock } from 'vitest';
import type { Obj } from '../api/types';
import type { Issue } from '../editor/issues';
import type { Ctx } from '../resources/ctx';
import type { SectionId } from '../upstream/meta';
import { upstreamSections } from '../upstream/sections';
import { UpstreamForm } from '../upstream/UpstreamForm';
import { LockProvider, TooltipProvider } from '../ui';
import { ctxOf } from './ctx';

export interface UpstreamOptions {
  /** Render just this section; default: the whole UpstreamForm. */
  section?: SectionId;
  layout?: 'sections' | 'tabs';
  locked?: boolean;
  ctx?: Ctx;
  issues?: Issue[];
}

export interface UpstreamHarness extends RenderResult {
  user: UserEvent;
  changes: Mock<(v: Obj) => void>;
  value: () => Obj;
  /** Re-renders with other options (locked, issues), keeping the current value. */
  update: (opts: Pick<UpstreamOptions, 'locked' | 'issues'>) => void;
}

export function renderUpstream(initial: Obj, opts: UpstreamOptions = {}): UpstreamHarness {
  const changes = vi.fn<(v: Obj) => void>();
  let current = initial;
  const ctx = opts.ctx ?? ctxOf();
  function Harness({ locked, issues }: Pick<UpstreamOptions, 'locked' | 'issues'>) {
    const [value, setValue] = useState(initial);
    const onChange = (v: Obj) => {
      current = v;
      changes(v);
      setValue(v);
    };
    const section = opts.section && upstreamSections.find((s) => s.id === opts.section);
    return (
      <MemoryRouter>
        <TooltipProvider>
          <LockProvider locked={locked ?? false}>
            {section ? (
              section.render({ value, onChange, issues: issues ?? [], ctx })
            ) : (
              <UpstreamForm value={value} onChange={onChange} issues={issues} ctx={ctx} layout={opts.layout ?? 'sections'} />
            )}
          </LockProvider>
        </TooltipProvider>
      </MemoryRouter>
    );
  }
  const user = userEvent.setup();
  const result = render(<Harness locked={opts.locked} issues={opts.issues} />);
  return {
    ...result,
    user,
    changes,
    value: () => current,
    update: (next) => result.rerender(<Harness {...next} />),
  };
}
