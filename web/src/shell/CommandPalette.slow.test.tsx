import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor } from '../test/editor';

// The palette's chunk arrives only when the test lets it: a slow network.
const chunk = vi.hoisted(() => {
  let release = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});
vi.mock('./CommandPalette', async (importOriginal) => {
  await chunk.arrived;
  return importOriginal();
});

beforeAll(async () => {
  // The module itself, compiled ahead, so only the gate decides when the palette's code arrives.
  await vi.importActual('./CommandPalette');
});

afterEach(() => {
  resetApp();
});

describe('a palette whose code arrives late', () => {
  it('does not open over a dialog that opened meanwhile', async () => {
    const { user } = await openEditor('#/upstreams/u1', { objects: { upstreams: [{ id: 'u1', name: 'web-pool', nodes: [] }] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('{Control>}k{/Control}');
    // While the chunk loads, the user opens the Delete confirmation.
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const confirm = await screen.findByRole('alertdialog');
    chunk.release();
    // The palette's code is now in, and React has drawn what it had waited for.
    await act(async () => {
      await import('./CommandPalette');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
    expect(confirm).toBeInTheDocument();
    // Once the confirmation is answered, the palette opens as usual.
    await user.click(within(confirm).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: t('palette.title') })).toBeInTheDocument();
  });
});
