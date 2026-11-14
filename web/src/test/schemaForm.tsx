// Renders a SchemaForm the way a tab does: controlled, the value held by the caller and replaced by
// every emitted change. `changes` records each emitted value; `value()` is the current one.
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { vi, type Mock } from 'vitest';
import type { Obj } from '../api/types';
import { SchemaForm, type SchemaFormProps } from '../schema-form/SchemaForm';
import { LockProvider } from '../ui';

type Extra = Omit<SchemaFormProps, 'schema' | 'value' | 'onChange'> & { locked?: boolean };

export interface FormHarness extends RenderResult {
  user: UserEvent;
  /** Called with every value the form emits. */
  changes: Mock<(v: unknown) => void>;
  /** The value now (the initial one until something is emitted). */
  value: () => unknown;
  /** Re-renders with other props (errors, locked), keeping the current value. */
  update: (extra: Extra) => void;
}

export function renderSchemaForm(schema: Obj, initial: unknown, extra: Extra = {}): FormHarness {
  const changes = vi.fn<(v: unknown) => void>();
  let current = initial;
  function Harness({ locked, ...props }: Extra) {
    const [value, setValue] = useState(initial);
    return (
      <LockProvider locked={locked ?? false}>
        <SchemaForm
          schema={schema}
          value={value}
          onChange={(v) => {
            current = v;
            changes(v);
            setValue(v);
          }}
          {...props}
        />
      </LockProvider>
    );
  }
  const user = userEvent.setup();
  const result = render(<Harness {...extra} />);
  return {
    ...result,
    user,
    changes,
    value: () => current,
    update: (next) => result.rerender(<Harness {...next} />),
  };
}

/** Every element that takes input (what a locked form must not contain). */
export function editableControls(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('input, textarea, select, [contenteditable="true"]')];
}
