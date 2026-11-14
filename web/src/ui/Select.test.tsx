import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { Select, type Option, type SelectProps } from './index';

const options: Option[] = [
  { value: 'roundrobin', label: 'Round robin' },
  { value: 'chash', label: 'Consistent hash', description: 'Same key, same node' },
  { value: 'ewma', label: 'EWMA' },
  { value: 'least_conn', label: 'Least connections' },
];

function Harness(props: Omit<SelectProps, 'value' | 'onChange' | 'options'> & {
  initial?: string;
  onChange: (v: string | undefined) => void;
}) {
  const { initial, onChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <Select
      label="Balancer"
      options={options}
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
  const onChange = vi.fn<(v: string | undefined) => void>();
  const user = userEvent.setup();
  render(<Harness {...props} onChange={onChange} />);
  return { onChange, user, trigger: screen.getByRole('combobox', { name: 'Balancer' }) };
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('Select', () => {
  it('shows the selected label, or the placeholder', () => {
    setup({ initial: 'chash' });
    expect(screen.getByRole('combobox', { name: 'Balancer' })).toHaveTextContent('Consistent hash');
  });

  it('picks an option by click', async () => {
    const { onChange, user, trigger } = setup({ placeholder: 'Pick one' });
    expect(trigger).toHaveTextContent('Pick one');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /EWMA/ }));
    expect(onChange).toHaveBeenLastCalledWith('ewma');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveTextContent('EWMA');
  });

  it('picks an option with the keyboard', async () => {
    const { onChange, user, trigger } = setup({ initial: 'roundrobin' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('chash');
    expect(trigger).toHaveFocus();
  });

  it('with searchable, filters the options as you type', async () => {
    const { onChange, user, trigger } = setup({ searchable: true });
    await user.click(trigger);
    const search = screen.getByRole('textbox', { name: t('ui.select.search') });
    expect(search).toHaveFocus();
    expect(optionNames()).toHaveLength(4);
    await user.type(search, 'conn');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Least connections');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('least_conn');
  });

  it('with searchable, says so when nothing matches', async () => {
    const { user, trigger } = setup({ searchable: true });
    await user.click(trigger);
    await user.type(screen.getByRole('textbox', { name: t('ui.select.search') }), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(t('ui.select.noMatches'))).toBeInTheDocument();
  });

  it('with clearable, emits undefined from the clear button', async () => {
    const { onChange, user } = setup({ initial: 'chash', clearable: true });
    await user.click(screen.getByRole('button', { name: t('ui.select.clear') }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole('button', { name: t('ui.select.clear') })).toBeNull();
  });
});
