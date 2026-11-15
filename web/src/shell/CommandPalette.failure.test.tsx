import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef } from '../test/editor';
import { getToasts } from '../ui/toast';

// The palette's chunk cannot be fetched (a dropped connection, a deploy that removed the old chunk).
vi.mock('./CommandPalette', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
});

describe('a palette that fails to load', () => {
  it('leaves an editor with unsaved changes as it was, and says so', async () => {
    // React reports the error the palette's boundary caught; the test expects it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [{ id: 'r1', name: 'shop', uri: '/cart/*' }] } });
    await main().findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'more');
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(getToasts().at(-1)?.message.startsWith(t('palette.unavailable', { error: '' }))).toBe(true));
    expect(getToasts().at(-1)?.tone).toBe('error');
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/cart/*more');
    expect(window.location.hash).toBe('#/routes/r1');
  });
});
