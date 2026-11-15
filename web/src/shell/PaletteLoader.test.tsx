import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { TooltipProvider } from '../ui';
import { getToasts } from '../ui/toast';
import { Toaster } from '../ui/Toaster';
import type { CommandPaletteProps } from './CommandPalette';
import { lazyPalette } from './PaletteLoader';
import type { PaletteExit } from './usePalette';

afterEach(() => {
  vi.restoreAllMocks();
});

const FAILED = 'Failed to fetch dynamically imported module';

function Loaded({ onClose }: CommandPaletteProps) {
  return (
    <button type="button" onClick={() => onClose('dismiss')}>
      palette loaded
    </button>
  );
}

/** A page with a draft, and the palette as the shell mounts it: only while open. */
function Page({ Palette, closed }: { Palette: ReturnType<typeof lazyPalette>; closed: (how: PaletteExit) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Palette
          onClose={(how) => {
            closed(how);
            setOpen(false);
          }}
        />
      )}
      <Toaster />
    </TooltipProvider>
  );
}

describe('lazyPalette', () => {
  it('a palette that fails to load closes with a message, leaves the page as it was, and loads again on the next open', async () => {
    // React reports the error the boundary caught; the test expects it.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    const load = vi.fn(() => (fail ? Promise.reject(new Error(FAILED)) : Promise.resolve({ default: Loaded })));
    const closed = vi.fn();
    const user = userEvent.setup();
    render(<Page Palette={lazyPalette(load)} closed={closed} />);
    await user.type(screen.getByRole('textbox', { name: 'draft' }), 'kept');
    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => expect(closed).toHaveBeenCalledWith('dismiss'));
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: t('palette.unavailable', { error: FAILED }) });
    expect(logged).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('kept');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByRole('button', { name: 'palette loaded' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a palette that throws while drawing closes with a message and leaves the page as it was', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('cannot draw');
    }
    const closed = vi.fn();
    const user = userEvent.setup();
    render(<Page Palette={lazyPalette(() => Promise.resolve({ default: Broken }))} closed={closed} />);
    await user.type(screen.getByRole('textbox', { name: 'draft' }), 'kept');
    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => expect(closed).toHaveBeenCalledWith('dismiss'));
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: t('palette.unavailable', { error: 'cannot draw' }) });
    expect(logged).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('kept');
  });
});
