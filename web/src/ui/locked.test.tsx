import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  Checkbox,
  Input,
  KeyValueInput,
  LockProvider,
  NumberInput,
  Select,
  Switch,
  TagInput,
  Textarea,
  useLocked,
} from './index';

const noop = (): void => {};

// Anything a user could type into, toggle or pick from.
const FORM_CONTROL = 'input, textarea, select, [contenteditable], [role="switch"], [role="checkbox"], [role="combobox"], [role="spinbutton"]';

function renderLocked(ui: ReactElement) {
  const { container } = render(<LockProvider locked>{ui}</LockProvider>);
  return container;
}

/** The single `.ro-value` element rendered, after checking no form control or disabled styling exists. */
function roValue(container: HTMLElement): HTMLElement {
  expect(container.querySelector(FORM_CONTROL)).toBeNull();
  expect(container.querySelector('[disabled], [aria-disabled="true"]')).toBeNull();
  const values = container.querySelectorAll<HTMLElement>('.ro-value');
  expect(values).toHaveLength(1);
  return values[0] as HTMLElement;
}

describe('useLocked', () => {
  function Probe() {
    return <span>{useLocked() ? 'locked' : 'unlocked'}</span>;
  }

  it('is false outside a provider and follows the provider inside one', () => {
    const { rerender } = render(<Probe />);
    expect(screen.getByText('unlocked')).toBeInTheDocument();
    rerender(
      <LockProvider locked>
        <Probe />
      </LockProvider>,
    );
    expect(screen.getByText('locked')).toBeInTheDocument();
    rerender(
      <LockProvider locked={false}>
        <Probe />
      </LockProvider>,
    );
    expect(screen.getByText('unlocked')).toBeInTheDocument();
  });
});

describe('locked rendering', () => {
  it('Input shows its value as text, and — when empty', () => {
    const c = renderLocked(<Input label="Name" value="game-api" onChange={noop} />);
    expect(roValue(c)).toHaveTextContent(/^game-api$/);
    expect(screen.getByText('Name')).toBeInTheDocument();

    const empty = renderLocked(<Input label="Name" value="" onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  // Task 16b item 15: a password field is a secret whether or not the caller says so.
  it('Input type="password" without `secret` is masked when locked, with the reveal toggle, and has the toggle when editing', () => {
    renderLocked(<Input label="Password" type="password" value="hunter2-pass" onChange={noop} />);
    expect(document.body.textContent).not.toContain('hunter2-pass');
    expect(screen.getByRole('button', { name: t('ui.secret.show') })).toBeInTheDocument();
    render(<Input label="Password again" type="password" value="hunter2-pass" onChange={noop} />);
    expect(screen.getByLabelText('Password again')).toHaveAttribute('type', 'password');
    expect(screen.getAllByRole('button', { name: t('ui.secret.show') })).toHaveLength(2);
  });

  it('Input with mono renders the value in monospace', () => {
    const c = renderLocked(<Input value="api.example.games" mono onChange={noop} />);
    expect(roValue(c)).toHaveClass('mono');
  });

  it('Select shows the selected option label, and — when nothing is selected', () => {
    const options = [
      { value: 'roundrobin', label: 'Round robin' },
      { value: 'chash', label: 'Consistent hash' },
    ];
    const c = renderLocked(<Select value="chash" options={options} onChange={noop} />);
    expect(roValue(c)).toHaveTextContent(/^Consistent hash$/);

    const empty = renderLocked(<Select value={undefined} options={options} onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  it('Switch shows On / Off as text', () => {
    const on = renderLocked(<Switch checked onChange={noop} label="Enabled" />);
    expect(roValue(on)).toHaveTextContent(/^On$/);

    const off = renderLocked(<Switch checked={false} onChange={noop} label="Enabled" />);
    expect(roValue(off)).toHaveTextContent(/^Off$/);
  });

  it('TagInput shows tags as static chips, and — when empty', () => {
    const c = renderLocked(<TagInput value={['a.example.com', 'b.example.com']} onChange={noop} />);
    const value = roValue(c);
    expect(value).toHaveTextContent('a.example.com');
    expect(value).toHaveTextContent('b.example.com');
    expect(c.querySelector('button')).toBeNull();

    const empty = renderLocked(<TagInput value={[]} onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  it('NumberInput shows the number, and — when undefined', () => {
    const c = renderLocked(<NumberInput value={8080} onChange={noop} />);
    expect(roValue(c)).toHaveTextContent(/^8080$/);

    const zero = renderLocked(<NumberInput value={0} onChange={noop} />);
    expect(roValue(zero)).toHaveTextContent(/^0$/);

    const empty = renderLocked(<NumberInput value={undefined} onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  it('Textarea keeps line breaks, and shows — when empty', () => {
    const c = renderLocked(<Textarea value={'line one\nline two'} onChange={noop} />);
    const value = roValue(c);
    expect(value.textContent).toBe('line one\nline two');

    const empty = renderLocked(<Textarea value="" onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  it('Checkbox shows a ✓ or ✗ mark with its label at full contrast', () => {
    const on = renderLocked(
      <Checkbox checked onChange={noop}>
        Verify certificate
      </Checkbox>,
    );
    const onValue = roValue(on);
    expect(onValue).toHaveTextContent('Verify certificate');
    expect(onValue).toHaveTextContent('Yes');
    expect(onValue.querySelector('[data-mark="checked"]')).not.toBeNull();

    const off = renderLocked(
      <Checkbox checked={false} onChange={noop}>
        Verify certificate
      </Checkbox>,
    );
    const offValue = roValue(off);
    expect(offValue).toHaveTextContent('No');
    expect(offValue.querySelector('[data-mark="unchecked"]')).not.toBeNull();
  });

  it('KeyValueInput shows a two-column list, and — when empty', () => {
    const c = renderLocked(<KeyValueInput value={{ env: 'prod', team: 'core' }} onChange={noop} />);
    const value = roValue(c);
    const terms = [...value.querySelectorAll('dt')].map((el) => el.textContent);
    const defs = [...value.querySelectorAll('dd')].map((el) => el.textContent);
    expect(terms).toEqual(['env', 'team']);
    expect(defs).toEqual(['prod', 'core']);
    expect(c.querySelector('button')).toBeNull();

    const empty = renderLocked(<KeyValueInput value={{}} onChange={noop} />);
    expect(roValue(empty)).toHaveTextContent(/^—$/);
  });

  it('renders editable controls again once unlocked', () => {
    const { container } = render(
      <LockProvider locked={false}>
        <Input value="game-api" onChange={noop} />
        <Switch checked onChange={noop} aria-label="Enabled" />
      </LockProvider>,
    );
    expect(container.querySelector('input')).toHaveValue('game-api');
    expect(screen.getByRole('switch')).toBeChecked();
    expect(container.querySelector('.ro-value')).toBeNull();
  });
});
