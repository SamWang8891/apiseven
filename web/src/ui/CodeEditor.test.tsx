import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditor, LockProvider } from './index';

// CodeMirror runs for real here; jsdom does no layout, so these tests stick to the document
// model: what is shown, and whether typing is let through.

async function editor(name: string): Promise<HTMLElement> {
  return screen.findByRole('textbox', { name });
}

describe('CodeEditor', () => {
  it('focus on the loading stand-in moves to the editor when it arrives, not to the page (fix round 1, R6.4)', async () => {
    render(<CodeEditor value="a: 1" language="yaml" onChange={() => {}} aria-label="While loading" />);
    const fallback = document.querySelector<HTMLElement>('.ui-code__fallback');
    // The first render of a test file shows the stand-in while CodeMirror's chunk loads.
    if (fallback) {
      fallback.focus();
      expect(fallback).toHaveFocus();
    }
    const content = await editor('While loading');
    if (fallback) expect(content).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('renders the value', async () => {
    render(<CodeEditor value={'{\n  "uri": "/v1/*"\n}'} language="json" onChange={() => {}} aria-label="Route JSON" />);
    const content = await editor('Route JSON');
    expect(content).toHaveTextContent('"uri": "/v1/*"');
  });

  it('emits the new text when typed into', async () => {
    const onChange = vi.fn<(v: string) => void>();
    const user = userEvent.setup();
    render(<CodeEditor value="" language="text" onChange={onChange} aria-label="Notes" />);
    await user.type(await editor('Notes'), 'hi');
    expect(onChange).toHaveBeenLastCalledWith('hi');
  });

  it('with readOnly, does not emit changes and says it is read-only', async () => {
    const onChange = vi.fn<(v: string) => void>();
    const user = userEvent.setup();
    render(<CodeEditor value="key: 1" language="yaml" readOnly onChange={onChange} aria-label="Config" />);
    const content = await editor('Config');
    expect(content).toHaveAttribute('aria-readonly', 'true');
    await user.type(content, 'zz');
    expect(onChange).not.toHaveBeenCalled();
    expect(content).toHaveTextContent('key: 1');
  });

  it('is read-only when locked', async () => {
    const onChange = vi.fn<(v: string) => void>();
    const user = userEvent.setup();
    render(
      <LockProvider locked>
        <CodeEditor value="return 1" language="lua" onChange={onChange} aria-label="Script" />
      </LockProvider>,
    );
    const content = await editor('Script');
    expect(content).toHaveAttribute('aria-readonly', 'true');
    await user.type(content, 'zz');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a new value from the parent without echoing it back', async () => {
    const onChange = vi.fn<(v: string) => void>();
    const { rerender } = render(<CodeEditor value="a" language="text" onChange={onChange} aria-label="Notes" />);
    await editor('Notes');
    rerender(<CodeEditor value="b" language="text" onChange={onChange} aria-label="Notes" />);
    expect(await editor('Notes')).toHaveTextContent(/^b$/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
