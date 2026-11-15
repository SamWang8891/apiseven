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
  // Task 16b item 19: the field's help and error describe its inputs.
  it("its help, then its error, is every input's accessible description", () => {
    const { rerender } = render(<KeyValueInput label="Labels" help="Shown in the list" value={{ env: 'prod' }} onChange={() => {}} />);
    expect(keyInput(1)).toHaveAccessibleDescription('Shown in the list');
    expect(valueInput(1)).toHaveAccessibleDescription('Shown in the list');
    rerender(<KeyValueInput label="Labels" help="Shown in the list" error="Too many labels" value={{ env: 'prod' }} onChange={() => {}} />);
    expect(keyInput(1)).toHaveAccessibleDescription('Too many labels');
    expect(valueInput(1)).toHaveAccessibleDescription('Too many labels');
  });

  it("a row's own problem is the inputs' accessible description too", async () => {
    const { user } = setup({ env: 'prod' });
    await user.click(screen.getByRole('button', { name: t('ui.kv.add') }));
    await user.type(valueInput(2), 'orphan');
    expect(keyInput(2)).toHaveAccessibleDescription(t('ui.kv.noKey'));
  });

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

  it('keeps a stored entry with an empty key through an edit of another row', async () => {
    const { onChange, user } = setup({ '': 'x', a: 'y' });
    await user.type(valueInput(2), '!');
    expect(onChange).toHaveBeenLastCalledWith({ '': 'x', a: 'y!' });
  });

  it('renaming a key to one already stored keeps the stored entry and flags the renamed row', async () => {
    const { onChange, user } = setup({ env: 'prod', team: 'core' });
    await user.clear(keyInput(1));
    await user.type(keyInput(1), 'team');
    // Held: the row's last good entry (env) stays in the map, in its place.
    expect(onChange).toHaveBeenLastCalledWith({ env: 'prod', team: 'core' });
    expect(keyInput(1)).toHaveAttribute('aria-invalid', 'true');
    expect(keyInput(2)).not.toHaveAttribute('aria-invalid');
    await user.type(keyInput(1), 's');
    expect(onChange).toHaveBeenLastCalledWith({ teams: 'prod', team: 'core' });
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
