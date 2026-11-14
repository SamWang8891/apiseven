// Renders a SchemaForm the way a tab does: controlled, the value held by the caller and replaced by
// every emitted change. `changes` records each emitted value; `value()` is the current one.
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { vi, type Mock } from 'vitest';
import type { Obj } from '../api/types';
import { SchemaForm, type SchemaFormProps } from '../schema-form/SchemaForm';
import { LockProvider, PendingProvider, type PendingEntry } from '../ui';

type Extra = Omit<SchemaFormProps, 'schema' | 'value' | 'onChange'> & { locked?: boolean };

export interface FormHarness extends RenderResult {
  user: UserEvent;
  /** Called with every value the form emits. */
  changes: Mock<(v: unknown) => void>;
  /** The value now (the initial one until something is emitted). */
  value: () => unknown;
  /** Re-renders with other props (errors, locked), keeping the current value. */
  update: (extra: Extra) => void;
  /** What the form's fields hold but have not emitted (usePending), as messages. */
  held: () => string[];
}

export function renderSchemaForm(schema: Obj, initial: unknown, extra: Extra = {}): FormHarness {
  const changes = vi.fn<(v: unknown) => void>();
  let current = initial;
  let pending: PendingEntry[] = [];
  const onPending = (entries: PendingEntry[]) => {
    pending = entries;
  };
  function Harness({ locked, ...props }: Extra) {
    const [value, setValue] = useState(initial);
    return (
      <PendingProvider onChange={onPending}>
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
      </PendingProvider>
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
    held: () => pending.map((entry) => entry.message),
  };
}

/** Native inputs, editable text, and the kit's button-based controls (Checkbox, Segmented, Select, Switch, …) by their role. */
const CONTROLS = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  ...['checkbox', 'radio', 'combobox', 'switch', 'spinbutton', 'textbox', 'slider', 'listbox'].map((role) => `[role="${role}"]`),
].join(', ');

/**
 * Every element that takes input (what a locked form must not contain): native inputs and
 * contenteditable, and any control by role. A read-only one (aria-readonly, as a locked CodeMirror
 * is) and one hidden from assistive tech don't count; a disabled one does, as a locked view must not
 * show disabled controls either.
 */
export function editableControls(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(CONTROLS)].filter(
    (el) => el.getAttribute('aria-readonly') !== 'true' && !el.hasAttribute('readonly') && !el.closest('[aria-hidden="true"]') && !el.matches('input[type="hidden"]'),
  );
}
