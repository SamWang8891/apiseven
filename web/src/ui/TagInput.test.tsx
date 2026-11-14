import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { TagInput } from './index';

function Harness({
  initial = [],
  onChange,
  validate,
}: {
  initial?: string[];
  onChange: (v: string[]) => void;
  validate?: (tag: string) => string | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TagInput
      label="Hosts"
      value={value}
      validate={validate}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function setup(props: Omit<Parameters<typeof Harness>[0], 'onChange'> = {}) {
  const onChange = vi.fn<(v: string[]) => void>();
  const user = userEvent.setup();
  render(<Harness {...props} onChange={onChange} />);
  const input = screen.getByRole('textbox', { name: 'Hosts' });
  return { onChange, user, input };
}

describe('TagInput', () => {
  it('adds the typed tag on Enter', async () => {
    const { onChange, user, input } = setup();
    await user.type(input, 'a.example.com{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['a.example.com']);
    expect(input).toHaveValue('');
    expect(screen.getByText('a.example.com')).toBeInTheDocument();
  });

  it('adds the typed tag on comma, without the comma', async () => {
    const { onChange, user, input } = setup({ initial: ['a'] });
    await user.type(input, 'b,');
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    expect(input).toHaveValue('');
  });

  it('adds the typed tag on Tab', async () => {
    const { onChange, user, input } = setup();
    await user.type(input, 'a');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });

  it('splits pasted text on whitespace and commas', async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste('a, b c');
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b', 'c']);
    expect(input).toHaveValue('');
  });

  it('ignores duplicates', async () => {
    const { onChange, user, input } = setup({ initial: ['a'] });
    await user.type(input, 'a{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
    await user.click(input);
    await user.paste('a b b');
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('removes the last tag on Backspace in an empty input', async () => {
    const { onChange, user, input } = setup({ initial: ['a', 'b'] });
    await user.click(input);
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });

  it('keeps the text and shows the message when validate rejects a tag', async () => {
    const validate = (tag: string) => (/^[a-z.]+$/.test(tag) ? undefined : 'Not a host name');
    const { onChange, user, input } = setup({ validate });
    await user.type(input, 'BAD!{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('BAD!');
    expect(screen.getByText('Not a host name')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('removes a tag with its remove button', async () => {
    const { onChange, user } = setup({ initial: ['a', 'b'] });
    await user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: 'a' }) }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });
});
