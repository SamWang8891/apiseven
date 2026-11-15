// Save pressed from the keyboard keeps focus (the kit Button is busy, not disabled, while it saves):
// on Save while the write is out, and still on Save after APISIX refuses it. jsdom applies no focus
// fixup, so what is pinned here is that Save is never disabled meanwhile; e2e checks the focus itself.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };

describe('Save from the keyboard', () => {
  it('keeps focus on Save while the save is out (busy, not disabled; a second press sends nothing) and after APISIX refuses it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user, admin } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? gate.then(() => json(400, { error_msg: 'refused by APISIX' })) : undefined) },
    });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    const save = main().getByRole('button', { name: t('editor.save') });
    save.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    release();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent('refused by APISIX');
    expect(save).not.toHaveAttribute('aria-busy');
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(save).toHaveFocus();
    expect(writesOf(admin)).toHaveLength(1);
  });
});
