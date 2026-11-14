import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { NumberInput, type NumberInputProps } from './index';

function Harness(props: Omit<NumberInputProps, 'value' | 'onChange'> & {
  initial?: number;
  onChange: (v: number | undefined) => void;
}) {
  const { initial, onChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      label="Port"
      {...rest}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function setup(props: Omit<Parameters<typeof Harness>[0], 'onChange'> = {}) {
  const onChange = vi.fn<(v: number | undefined) => void>();
  const user = userEvent.setup();
  render(<Harness {...props} onChange={onChange} />);
  return { onChange, user, input: screen.getByRole('spinbutton', { name: 'Port' }) };
}

describe('NumberInput', () => {
  it('emits numbers, not strings', async () => {
    const { onChange, user, input } = setup();
    await user.type(input, '8080');
    expect(onChange).toHaveBeenLastCalledWith(8080);
    expect(typeof onChange.mock.lastCall?.[0]).toBe('number');

    await user.type(input, '.5');
    expect(onChange).toHaveBeenLastCalledWith(8080.5);
  });

  it('emits undefined when cleared', async () => {
    const { onChange, user, input } = setup({ initial: 30 });
    expect(input).toHaveValue('30');
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('does not emit text that is not a number, and says why', async () => {
    const { onChange, user, input } = setup({ initial: 1 });
    await user.clear(input);
    onChange.mockClear();
    await user.type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(t('ui.number.invalid'))).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('with integer, refuses fractions', async () => {
    const { onChange, user, input } = setup({ integer: true });
    await user.type(input, '1.5');
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByText(t('ui.number.integer'))).toBeInTheDocument();
  });

  it('flags values outside min/max', async () => {
    const { user, input } = setup({ min: 1, max: 65535 });
    await user.type(input, '70000');
    expect(screen.getByText(t('ui.number.max', { max: 65535 }))).toBeInTheDocument();
  });

  it('steps with the arrow keys', async () => {
    const { onChange, user, input } = setup({ initial: 0.1, step: 0.1 });
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('follows a new value from the parent', () => {
    const { rerender } = render(<NumberInput label="Port" value={1} onChange={() => {}} />);
    rerender(<NumberInput label="Port" value={2} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue('2');
  });
});
