import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { KeyValueInput } from './index';

type Map = Record<string, string>;

function Harness({ initial, onChange }: { initial: Map; onChange: (v: Map) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <KeyValueInput
      label="Labels"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function setup(initial: Map) {
  const onChange = vi.fn<(v: Map) => void>();
  const user = userEvent.setup();
  render(<Harness initial={initial} onChange={onChange} />);
  return { onChange, user };
}

const keyInput = (n: number) => screen.getByRole('textbox', { name: t('ui.kv.keyN', { n }) });
const valueInput = (n: number) => screen.getByRole('textbox', { name: t('ui.kv.valueN', { n }) });

describe('KeyValueInput', () => {
  it('shows one row per entry', () => {
    setup({ env: 'prod', team: 'core' });
    expect(keyInput(1)).toHaveValue('env');
    expect(valueInput(1)).toHaveValue('prod');
    expect(keyInput(2)).toHaveValue('team');
    expect(valueInput(2)).toHaveValue('core');
  });

  it('edits a value', async () => {
    const { onChange, user } = setup({ env: 'prod' });
    await user.clear(valueInput(1));
    await user.type(valueInput(1), 'dev');
    expect(onChange).toHaveBeenLastCalledWith({ env: 'dev' });
  });

  it('renames a key, keeping its value and position', async () => {
    const { onChange, user } = setup({ env: 'prod', team: 'core' });
    await user.clear(keyInput(1));
    await user.type(keyInput(1), 'stage');
    expect(onChange).toHaveBeenLastCalledWith({ stage: 'prod', team: 'core' });
    expect(Object.keys(onChange.mock.lastCall?.[0] ?? {})).toEqual(['stage', 'team']);
  });

  it('adds an entry', async () => {
    const { onChange, user } = setup({ env: 'prod' });
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    expect(keyInput(2)).toHaveFocus();
    await user.keyboard('team');
    expect(onChange).toHaveBeenLastCalledWith({ env: 'prod', team: '' });
    await user.type(valueInput(2), 'core');
    expect(onChange).toHaveBeenLastCalledWith({ env: 'prod', team: 'core' });
  });

  it('removes an entry', async () => {
    const { onChange, user } = setup({ env: 'prod', team: 'core' });
    await user.click(screen.getByRole('button', { name: t('ui.kv.remove', { n: 1 }) }));
    expect(onChange).toHaveBeenLastCalledWith({ team: 'core' });
    expect(keyInput(1)).toHaveValue('team');
  });

  it('starts an empty map with one blank row, and never drops to zero rows', async () => {
    const { onChange, user } = setup({});
    expect(keyInput(1)).toHaveValue('');
    await user.type(keyInput(1), 'env');
    expect(onChange).toHaveBeenLastCalledWith({ env: '' });
    await user.click(screen.getByRole('button', { name: t('ui.kv.remove', { n: 1 }) }));
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(keyInput(1)).toHaveValue('');
    expect(keyInput(1)).toHaveFocus();
  });

  it('keeps the first of two equal keys and flags the second', async () => {
    const { onChange, user } = setup({ env: 'prod' });
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    await user.keyboard('env');
    await user.type(valueInput(2), 'dev');
    expect(onChange).toHaveBeenLastCalledWith({ env: 'prod' });
    expect(screen.getByText(t('ui.kv.duplicate'))).toBeInTheDocument();
  });
});
