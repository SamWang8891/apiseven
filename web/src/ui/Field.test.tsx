import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Input, LockProvider, Textarea } from './index';

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
