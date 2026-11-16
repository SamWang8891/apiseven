// Final wave C1 and G3: once a write was refused for the key (a viewer key), the connection is known
// read-only and nothing more is sent: the one rule is in the write path (api/write.ts useWrite), which
// the editor's save and every confirm go through. The controls the user pressed stay focusable,
// unavailable (aria-disabled) with the reason, and the draft stays to be copied out.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from './types';
import { resetReadOnlyKeys } from './write';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const VIEWER = { error_msg: 'failed to check token', description: 'invalid method for role viewer' };
const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('the editor with a key found read-only (C1)', () => {
  it('one refused PUT; then Save, Cmd-S and Ctrl-S send nothing; Save keeps focus, unavailable with the reason; the draft stays', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { admin } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(401, VIEWER) : undefined) },
    });
    const user = userEvent.setup();
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    const save = main().getByRole('button', { name: t('editor.save') });
    await user.click(save);

    const banner = await main().findByRole('alert');
    expect(within(banner).getByText('failed to check token: invalid method for role viewer')).toBeInTheDocument();
    expect(screen.getByText(t('readOnly.banner'))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: expect.objectContaining({ uri: '/b' }) as unknown }]);
    const sent = admin.requests.length;

    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).toHaveAccessibleDescription(t('editor.readOnlySave'));

    await user.click(save);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await settle();
    // No GET (the conflict check) and no PUT.
    expect(admin.requests.length).toBe(sent);
    expect(uri).toHaveValue('/b');
    expect(main().getByText(t('editor.editing'))).toBeInTheDocument();
    // Cmd/Ctrl-S is told why, where the last refusal was.
    const notSent = await main().findByRole('alert');
    expect(within(notSent).getByText(t('editor.notSent'))).toBeInTheDocument();
    expect(within(notSent).getByText(t('editor.readOnlySave'))).toBeInTheDocument();
  });

  it('Save anyway, refused for the key, stays where it was (focusable) and is unavailable likewise; pressing it sends nothing', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], validate: (d) => (d.uri === '/b' ? [{ path: 'uri', message: 'stricter than APISIX' }] : []) }));
    const { admin } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(401, VIEWER) : undefined) },
    });
    const user = userEvent.setup();
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    const anyway = await main().findByRole('button', { name: t('editor.anyway.action') });
    await user.click(anyway);
    await user.click(await screen.findByRole('button', { name: t('editor.anyway.confirm') }));
    await screen.findByText(t('readOnly.banner'));
    expect(writesOf(admin)).toHaveLength(1);
    const sent = admin.requests.length;

    const still = main().getByRole('button', { name: t('editor.anyway.action') });
    await waitFor(() => expect(still).toHaveAttribute('aria-disabled', 'true'));
    expect(still).toHaveFocus();
    expect(still).toHaveAccessibleDescription(t('editor.readOnlySave'));
    // The notice beside it would say nothing else stops the save: it goes.
    expect(main().queryByText(t('editor.anyway.bodyOne'))).not.toBeInTheDocument();
    await user.click(still);
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await settle();
    expect(admin.requests.length).toBe(sent);
    expect(uri).toHaveValue('/b');
  });
});

describe('Delete with a key found read-only (G3)', () => {
  const ROUTES: Obj[] = [
    { id: 'r1', name: 'alpha', uri: '/a' },
    { id: 'r2', name: 'beta', uri: '/b' },
  ];

  it('the refused DELETE leaves the dialog open with APISIX’s message; its Delete keeps focus, unavailable with the reason, and sends nothing again', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    const user = userEvent.setup();
    const { admin } = renderApp({ hash: '#/routes', counts: {}, objects: { routes: ROUTES }, replies: { 'routes/r1': (req) => (req.method === 'DELETE' ? json(401, VIEWER) : undefined) } });
    await screen.findByRole('main');
    const row = (await main().findByRole('link', { name: 'alpha' })).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: t('table.actionsFor', { name: 'alpha' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.routes.singular') }) });
    await user.click(confirm);

    expect(await within(dialog).findByText('failed to check token: invalid method for role viewer')).toBeInTheDocument();
    expect(await screen.findByText(t('readOnly.banner'))).toBeInTheDocument();
    const deletes = () => admin.requests.filter((r) => r.method === 'DELETE').length;
    expect(deletes()).toBe(1);

    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'));
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(t('readOnly.unavailable'));
    expect(within(dialog).getByText(t('readOnly.unavailable'))).toBeInTheDocument();
    await user.click(confirm);
    await user.keyboard('{Enter}');
    await settle();
    expect(deletes()).toBe(1);
    // Cancel still closes it.
    await user.click(within(dialog).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
