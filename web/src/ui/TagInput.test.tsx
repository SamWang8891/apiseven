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
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Hosts' });
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

  // Final wave O1: what a paste holds after a refused part is not dropped.
  it('a paste with a refused part: those before it are added; it and every part after it stay in the box, held, and are split again once it is corrected', async () => {
    const validate = (tag: string) => (tag.startsWith('/') ? undefined : 'Starts with /');
    const { onChange, user, input } = setup({ validate });
    await user.click(input);
    await user.paste('/first invalid /last');
    expect(onChange).toHaveBeenLastCalledWith(['/first']);
    expect(input).toHaveValue('invalid /last');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Starts with /')).toBeInTheDocument();
    // Leaving the box does not drop them either.
    await user.tab();
    expect(input).toHaveValue('invalid /last');
    expect(onChange).toHaveBeenCalledTimes(1);
    // The refused part corrected, Enter adds it and what came after it.
    await user.click(input);
    input.setSelectionRange(0, 'invalid'.length);
    await user.keyboard('/fixed{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['/first', '/fixed', '/last']);
    expect(input).toHaveValue('');
  });

  it('a later part refused after a correction stays with what follows it; typed text with a space is still one tag', async () => {
    const validate = (tag: string) => (tag.startsWith('/') ? undefined : 'Starts with /');
    const { onChange, user, input } = setup({ validate });
    await user.click(input);
    await user.paste('bad1 /b bad2 /d');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('bad1 /b bad2 /d');
    input.setSelectionRange(0, 'bad1'.length);
    await user.keyboard('/a{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['/a', '/b']);
    expect(input).toHaveValue('bad2 /d');
    await user.clear(input);
    await user.type(input, '/x y{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['/a', '/b', '/x y']);
  });

  // Final wave O2: a paste of several tags replaces the selection, as any paste does.
  it('a paste of several tags replaces the selected text first, then splits', async () => {
    const { onChange, user, input } = setup();
    await user.type(input, '/old');
    input.setSelectionRange(0, input.value.length);
    await user.paste('/new /other');
    expect(onChange).toHaveBeenLastCalledWith(['/new', '/other']);
    expect(input).toHaveValue('');
  });

  it('a paste of several tags goes in at the caret, then splits', async () => {
    const { onChange, user, input } = setup();
    await user.type(input, '/ab');
    input.setSelectionRange(2, 2);
    await user.paste('X /y');
    expect(onChange).toHaveBeenLastCalledWith(['/aX', '/yb']);
  });

  it('removes a tag with its remove button', async () => {
    const { onChange, user } = setup({ initial: ['a', 'b'] });
    await user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: 'a' }) }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });
});
