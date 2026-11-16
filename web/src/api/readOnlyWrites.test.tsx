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
    // The field on the page now (the first, refused save remounted it): the draft is still there.
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/b');
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
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/b');
  });

  // Fix round 1, F1: the refusal comes before the saving state, so nothing remounts and the field typed in keeps focus.
  it('Cmd/Ctrl-S from a field, once the key is known read-only: no request, no saving state, focus stays on that very field', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { admin } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(401, VIEWER) : undefined) },
    });
    const user = userEvent.setup();
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'x');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await screen.findByText(t('readOnly.banner'));
    const sent = admin.requests.length;

    const field = main().getByRole('textbox', { name: 'URI' });
    await user.click(field);
    await user.type(field, 'y');
    for (const keys of ['{Control>}s{/Control}', '{Meta>}s{/Meta}']) {
      await user.keyboard(keys);
      await settle();
      expect(admin.requests.length).toBe(sent);
      expect(field.isConnected).toBe(true);
      expect(field).toHaveFocus();
      expect(field).toHaveValue('/axy');
      expect(main().getByRole('button', { name: t('editor.save') })).not.toHaveAttribute('aria-busy');
    }
    const notSent = await main().findByRole('alert');
    expect(within(notSent).getByText(t('editor.readOnlySave'))).toBeInTheDocument();
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

// Fix round 2, R3.2: the frame's blur can swap a field that just received a private key for its "not
// shown" view; a refused save then gives focus to what took its place, never to body.
describe('a refused save from a field swapped on leaving', () => {
  it('a key pasted into a plugin form’s text field, Ctrl-S with a read-only key: no request, focus on the field’s Replace', async () => {
    const { pluginReplies } = await import('../test/plugins');
    await import('../resources/routes/bodies');
    const ROUTE_PR: Obj = { ...ROUTE, plugins: { 'proxy-rewrite': { uri: '/x' } } };
    const { admin } = await openEditor('#/routes/r1?tab=plugins', {
      objects: { routes: [ROUTE_PR] },
      replies: { ...pluginReplies(), 'routes/r1': (req) => (req.method === 'PUT' ? json(401, VIEWER) : undefined) },
    });
    const user = userEvent.setup();
    await main().findByRole('heading', { level: 1, name: 'web' });
    const card = await main().findByRole('group', { name: 'proxy-rewrite' });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    await user.click(within(card).getByRole('button', { name: 'proxy-rewrite' }));
    await user.keyboard('e');
    const uri = await within(card).findByRole('textbox', { name: /^uri/ });
    await user.type(uri, 'y');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await screen.findByText(t('readOnly.banner'));
    const sent = admin.requests.length;

    const field = within(card).getByRole('textbox', { name: /^uri/ });
    await user.click(field);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('-----BEGIN PRIVATE KEY----- MIIEvQIBADANBgkqhkiG9w0BAQEFAASwappedKey -----END PRIVATE KEY-----');
    await user.keyboard('{Control>}s{/Control}');
    await settle();
    expect(admin.requests.length).toBe(sent);
    expect(field.isConnected).toBe(false);
    expect(document.body.innerHTML).not.toContain('SwappedKey');
    expect(within(card).getByRole('button', { name: t('sf.secret.replace', { name: 'uri' }) })).toHaveFocus();
  });
});
