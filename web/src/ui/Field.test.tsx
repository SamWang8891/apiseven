import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Checkbox, Input, LockProvider, NumberInput, Select, Switch, TagInput, Textarea } from './index';

const noop = (): void => {};

describe('Field (through Input)', () => {
  it('links the label, and describes the control with its help', () => {
    render(<Input label="Name" help="Shown in lists." value="a" onChange={noop} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('Shown in lists.');
  });

  it('shows the error in place of the help, and marks the control invalid', () => {
    const { container } = render(<Input label="Name" help="Shown in lists." error="Name is required" value="" onChange={noop} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('Name is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Shown in lists.')).toBeNull();
    expect(container.querySelector('.ui-field__error svg')).not.toBeNull();
  });

  it('marks required fields, but not while locked', () => {
    const { rerender } = render(<Input label="Name" required value="a" onChange={noop} />);
    expect(screen.getByRole('textbox', { name: `Name (${t('ui.required')})` })).toBeRequired();
    rerender(
      <LockProvider locked>
        <Input label="Name" required value="a" onChange={noop} />
      </LockProvider>,
    );
    expect(screen.queryByText('*')).toBeNull();
  });
});

describe('help and error reach every kit control', () => {
  type Texts = { help?: string; error?: string };
  // [name, the control with the given help/error, how to find the control]
  const cases: [string, (texts: Texts) => ReactElement, () => HTMLElement][] = [
    ['Input', (p) => <Input label="Name" value="" onChange={noop} {...p} />, () => screen.getByRole('textbox')],
    ['NumberInput', (p) => <NumberInput label="Port" value={1} onChange={noop} {...p} />, () => screen.getByRole('spinbutton')],
    ['Textarea', (p) => <Textarea label="Notes" value="" onChange={noop} {...p} />, () => screen.getByRole('textbox')],
    [
      'Select',
      (p) => <Select label="Scheme" value={undefined} options={[{ value: 'http', label: 'http' }]} onChange={noop} {...p} />,
      () => screen.getByRole('combobox'),
    ],
    ['Switch', (p) => <Switch label="Status" checked onChange={noop} {...p} />, () => screen.getByRole('switch')],
    ['Checkbox', (p) => <Checkbox label="TLS" checked={false} onChange={noop} {...p} />, () => screen.getByRole('checkbox')],
    [
      'Checkbox with an inline label',
      (p) => (
        <Checkbox label="TLS" checked={false} onChange={noop} {...p}>
          Verify certificate
        </Checkbox>
      ),
      () => screen.getByRole('checkbox', { name: 'Verify certificate' }),
    ],
    ['TagInput', (p) => <TagInput label="Hosts" value={[]} onChange={noop} {...p} />, () => screen.getByRole('textbox')],
  ];

  /** Every id the control's aria-describedby names is an element in the document. */
  function describedByResolves(control: HTMLElement) {
    for (const id of (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) {
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  }

  for (const [name, make, control] of cases) {
    it(`${name}: describes itself with the help, then with the error in its place`, () => {
      const { rerender } = render(make({ help: 'What this is for.' }));
      expect(control()).toHaveAccessibleDescription('What this is for.');
      describedByResolves(control());

      rerender(make({ help: 'What this is for.', error: 'This is wrong.' }));
      expect(control()).toHaveAccessibleDescription('This is wrong.');
      describedByResolves(control());
    });
  }
});

describe('Textarea height', () => {
  it('keeps the same minimum height locked and unlocked, so unlocking moves nothing below it', () => {
    const { container, rerender } = render(<Textarea rows={3} value="one line" onChange={noop} />);
    const editable = container.querySelector<HTMLElement>('textarea')?.style.minHeight;
    rerender(
      <LockProvider locked>
        <Textarea rows={3} value="one line" onChange={noop} />
      </LockProvider>,
    );
    expect(editable).toBe('68px');
    expect(container.querySelector<HTMLElement>('.ro-value')?.style.minHeight).toBe(editable);
  });
});
