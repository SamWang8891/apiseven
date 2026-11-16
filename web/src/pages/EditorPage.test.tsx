import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { getToasts } from '../ui/toast';
import { newPathFor, pathFor } from '../router/paths';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream_id: 'u1', create_time: 1700000000, update_time: 1700000100 };
const UPSTREAM: Obj = { id: 'u1', name: 'pool', type: 'roundrobin', nodes: [] };
const objects = () => ({ routes: [ROUTE], upstreams: [UPSTREAM] });

const tab = (name: string | RegExp) => main().getByRole('tab', { name });
const jsonLabel = t('editor.json.label', { kind: 'Route' });

describe('loading', () => {
  it('shows the object once loaded: name, id with a copy button, times', async () => {
    await openEditor('#/routes/r1', { objects: objects() });
    expect(await main().findByRole('heading', { level: 1, name: 'web' })).toBeInTheDocument();
    expect(main().getByText('r1')).toHaveClass('mono');
    expect(main().getByRole('button', { name: t('cell.copyId', { id: 'r1' }) })).toBeInTheDocument();
    expect(main().getByText(/^Updated /)).toBeInTheDocument();
    expect(main().getByText(/^Created \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)).toBeInTheDocument();
  });

  it('a 404 shows the not-found state with a way back to the list', async () => {
    await openEditor('#/routes/gone', { objects: objects() });
    expect(await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'gone' }) })).toBeInTheDocument();
    expect(main().getByRole('link', { name: t('editor.back', { plural: 'Routes' }) })).toHaveAttribute('href', '#/routes');
  });

  it('another failure shows the error with Retry', async () => {
    let fail = true;
    const { user } = await openEditor('#/routes/r1', {
      objects: objects(),
      replies: { 'routes/r1': () => (fail ? json(500, { error_msg: 'etcd down' }) : undefined) },
    });
    const alert = await main().findByRole('alert');
    expect(within(alert).getByText(t('editor.loadFailed', { kind: 'Route', id: 'r1' }))).toBeInTheDocument();
    expect(within(alert).getByText('HTTP 500: etcd down')).toBeInTheDocument();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: t('table.retry') }));
    expect(await main().findByRole('heading', { level: 1, name: 'web' })).toBeInTheDocument();
  });
});

describe('tabs in the URL', () => {
  it('?tab=json selects the JSON tab', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    await openEditor('#/routes/r1?tab=json', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    expect(tab('JSON')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('textbox', { name: jsonLabel })).toBeInTheDocument();
  });

  it('an unknown tab id falls back to the first tab; choosing a tab writes it to the URL', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await openEditor('#/routes/r1?tab=nope', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    expect(tab('General')).toHaveAttribute('aria-selected', 'true');
    await user.click(tab('JSON'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/r1?tab=json'));
  });
});

describe('create', () => {
  it('after a successful create, goes to the new object, locked', async () => {
    const { user } = await openEditor(`#${newPathFor('routes')}?upstream_id=u1`, { objects: { routes: [], upstreams: [UPSTREAM] } });
    await user.type(await main().findByRole('textbox', { name: 'ID' }), 'fresh');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('routes', 'fresh')}`));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(getToasts().at(-1)?.message).toBe(t('editor.created', { name: 'fresh' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Discard on a new object with changes asks, then returns to the list', async () => {
    const { user } = await openEditor(`#${newPathFor('routes')}`, { objects: { routes: [] } });
    await user.type(await main().findByRole('textbox', { name: 'ID' }), 'x');
    await user.click(main().getByRole('button', { name: t('editor.discard') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    await user.click(within(dialog).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
  });
});

describe('duplicate', () => {
  it('…/new?from=r1 starts unlocked from a copy: no id, " copy" appended to the name', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('routes')}?from=r1&tab=json`, { objects: objects() });
    expect(await main().findByRole('heading', { level: 1, name: t('page.new', { kind: 'Route' }) })).toBeInTheDocument();
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
    const editor = await screen.findByRole('textbox', { name: jsonLabel });
    expect(editor.textContent).toContain('"name": "web copy"');
    expect(editor.textContent).not.toContain('"id"');
    expect(editor.textContent).not.toContain('create_time');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'POST', path: 'routes', body: { name: 'web copy', uri: '/a', upstream_id: 'u1' } }]));
  });

  it('a consumer copy has its username cleared', async () => {
    await openEditor(`#${newPathFor('consumers')}?from=jo&tab=json`, { objects: { consumers: [{ username: 'jo', desc: 'Jo', plugins: { 'key-auth': {} } }] } });
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Consumer' }) });
    expect(editor.textContent).not.toContain('username');
    expect(editor.textContent).toContain('"key-auth": {}');
  });

  it('a copy of something missing shows not found', async () => {
    await openEditor(`#${newPathFor('routes')}?from=gone`, { objects: objects() });
    expect(await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'gone' }) })).toBeInTheDocument();
  });
});

describe('leaving with unsaved changes', () => {
  async function dirtyRoute() {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const app = await openEditor('#/routes/r1', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.keyboard('e');
    await app.user.type(await main().findByRole('textbox', { name: 'URI' }), '/more');
    return app;
  }

  it('in-app navigation asks; Cancel stays with the draft intact', async () => {
    const { user } = await dirtyRoute();
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    await user.click(within(dialog).getByRole('button', { name: t('ui.cancel') }));
    expect(window.location.hash).toBe('#/routes/r1');
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/a/more');
  });

  it('confirming navigates', async () => {
    const { user } = await dirtyRoute();
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe('#/upstreams'));
  });

  it('switching tabs never asks', async () => {
    const { user } = await dirtyRoute();
    await user.click(tab('JSON'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/r1?tab=json'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a clean editor navigates at once', async () => {
    const { user } = await openEditor('#/routes/r1', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/upstreams'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('closing or reloading the tab is held by beforeunload while dirty', async () => {
    await dirtyRoute();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('conflict', () => {
  async function conflicted() {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const app = await openEditor('#/routes/r1', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.keyboard('e');
    await app.user.type(await main().findByRole('textbox', { name: 'URI' }), '/mine');
    app.admin.touch('routes', 'r1', { uri: '/theirs' });
    await app.user.click(main().getByRole('button', { name: t('editor.save') }));
    const dialog = await screen.findByRole('dialog', { name: t('editor.conflict.title', { kind: 'Route', name: 'web' }) });
    return { ...app, dialog };
  }

  it('shows what changed on the server as a line diff and sends nothing', async () => {
    const { admin, dialog } = await conflicted();
    // Removed lines are <del>, added ones <ins>, so the change is not told by colour alone.
    expect(within(dialog).getByText('"uri": "/a"').closest('del')).not.toBeNull();
    expect(within(dialog).getByText('"uri": "/theirs"').closest('ins')).not.toBeNull();
    expect(within(dialog).getByText('"name": "web",').closest('del, ins')).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });

  it('Reload theirs loads the server version and locks', async () => {
    const { user, dialog, admin } = await conflicted();
    await user.click(within(dialog).getByRole('button', { name: t('editor.conflict.reload') }));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(main().getByText('/theirs')).toBeInTheDocument();
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });

  it('Overwrite with mine sends the PUT', async () => {
    const { user, dialog, admin } = await conflicted();
    await user.click(within(dialog).getByRole('button', { name: t('editor.conflict.overwrite') }));
    await waitFor(() => expect(writesOf(admin)).toMatchObject([{ method: 'PUT', path: 'routes/r1', body: { uri: '/a/mine' } }]));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(admin.stored('routes')[0]?.uri).toBe('/a/mine');
  });
});

describe('the ⋯ menu', () => {
  async function openMenu() {
    const app = await openEditor('#/routes/r1', { objects: objects() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.click(main().getByRole('button', { name: t('editor.more') }));
    return app;
  }

  it('Duplicate opens the create page from this object', async () => {
    const { user } = await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: t('action.duplicate') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/~new?from=r1'));
    expect(await main().findByRole('heading', { level: 1, name: t('page.new', { kind: 'Route' }) })).toBeInTheDocument();
  });

  it('View JSON shows the stored object', async () => {
    const { user } = await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const dialog = await screen.findByRole('dialog', { name: t('json.title', { kind: 'Route', name: 'web' }) });
    expect(within(dialog).getByRole('button', { name: t('json.copy') })).toBeInTheDocument();
  });

  it("View JSON closed, by Escape or Close, gives focus back to the menu's trigger, not body (final wave O3)", async () => {
    const { user } = await openMenu();
    const more = main().getByRole('button', { name: t('editor.more') });
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    await screen.findByRole('dialog', { name: t('json.title', { kind: 'Route', name: 'web' }) });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(more).toHaveFocus());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const dialog = await screen.findByRole('dialog', { name: t('json.title', { kind: 'Route', name: 'web' }) });
    // Its footer's Close (the header has the same button).
    await user.click(within(dialog).getAllByRole('button', { name: t('ui.close') }).at(-1) as HTMLElement);
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('Delete confirms, deletes and goes to the list', async () => {
    const { user, admin } = await openMenu();
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: 'Route' }) }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    expect(writesOf(admin)).toEqual([{ method: 'DELETE', path: 'routes/r1', body: undefined }]);
  });
});
