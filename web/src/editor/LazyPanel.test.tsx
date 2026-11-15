import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { lazyPanel } from './LazyPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

function Probe({ word }: { word: string }) {
  return <p>loaded {word}</p>;
}

describe('lazyPanel', () => {
  it('shows a Retry in place of a part that failed to load, keeping the page around it', async () => {
    // React reports the error the boundary caught; the test expects it.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    let fail = true;
    const load = vi.fn(() => (fail ? Promise.reject(new Error('Failed to fetch dynamically imported module')) : Promise.resolve(Probe)));
    const Panel = lazyPanel(load, () => <p>loading</p>);

    function Page() {
      const [text, setText] = useState('');
      return (
        <>
          <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
          <Panel word={text || 'nothing'} />
        </>
      );
    }
    render(<Page />);
    await user.type(screen.getByRole('textbox', { name: 'draft' }), 'kept');
    expect(await screen.findByRole('alert')).toHaveTextContent(t('editor.lazy.failed', { error: 'Failed to fetch dynamically imported module' }));
    expect(logged).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('kept');

    fail = false;
    await user.click(screen.getByRole('button', { name: t('editor.lazy.retry') }));
    expect(await screen.findByText('loaded kept')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('while it loads, the part is a busy status named Loading…, gone once loaded', async () => {
    let resolve: (c: typeof Probe) => void = () => {};
    const load = vi.fn(() => new Promise<typeof Probe>((r) => (resolve = r)));
    const Panel = lazyPanel(load, () => <p>loading</p>);
    render(<Panel word="a" />);
    const status = await screen.findByRole('status', { name: t('editor.lazy.loading') });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('loading');
    resolve(Probe);
    expect(await screen.findByText('loaded a')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('loads once and shares the result between panels', async () => {
    const load = vi.fn(() => Promise.resolve(Probe));
    const Panel = lazyPanel(load, () => <p>loading</p>);
    render(
      <>
        <Panel word="a" />
        <Panel word="b" />
      </>,
    );
    expect(screen.getAllByText('loading')).toHaveLength(2);
    expect(await screen.findByText('loaded a')).toBeInTheDocument();
    expect(screen.getByText('loaded b')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
