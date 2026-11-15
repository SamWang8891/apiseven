import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { stripTimestamps } from '../api/sanitize';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import type { TabDef } from '../resources/registry';
import { getToasts } from '../ui/toast';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, PROBE_TAB, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';
import { renderWithProviders } from '../test/providers';
import { EditorPage } from '../pages/EditorPage';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = {
  id: 'r1',
  name: 'web',
  uri: '/a',
  x_future: { a: 1 },
  upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] },
  create_time: 1700000000,
  update_time: 1700000100,
};

/** A new route that has something to do (APISIX needs an upstream, a service, plugins or a script). */
const NEW_ROUTE = '#/routes/new?upstream_id=u1';
const UPSTREAMS = [{ id: 'u1', name: 'pool', type: 'roundrobin', nodes: [] }];

/** An existing route r1 opened with a General tab (name, uri) before the JSON tab. */
async function openRoute(opts: Parameters<typeof openEditor>[1] = {}, hash = '#/routes/r1') {
  undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
  const app = await openEditor(hash, { objects: { routes: [ROUTE] }, ...opts });
  await main().findByRole('heading', { level: 1, name: 'web' });
  return app;
}

const button = (name: string) => main().getByRole('button', { name });
const tab = (name: string | RegExp) => main().getByRole('tab', { name });
const inputsInMain = () => screen.getByRole('main').querySelectorAll('input, textarea, select');

async function unlockAndSetUri(user: Awaited<ReturnType<typeof openRoute>>['user'], uri: string) {
  await user.keyboard('e');
  const field = await main().findByRole('textbox', { name: 'URI' });
  await user.clear(field);
  await user.type(field, uri);
}

describe('lock', () => {
  it('opens an existing route locked: no inputs, values as text; e unlocks; Discard locks again', async () => {
    const { user } = await openRoute();
    expect(main().getByText(t('editor.locked'))).toBeInTheDocument();
    expect(inputsInMain()).toHaveLength(0);
    expect(main().getByText('/a')).toBeInTheDocument();

    await user.keyboard('e');
    expect(await main().findByRole('textbox', { name: 'URI' })).toHaveValue('/a');
    expect(main().getByRole('textbox', { name: 'Name' })).toHaveValue('web');
    expect(main().getByText(t('editor.editing'))).toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('editor.edit') })).not.toBeInTheDocument();

    await user.click(button(t('editor.discard')));
    await waitFor(() => expect(inputsInMain()).toHaveLength(0));
    expect(button(t('editor.edit'))).toBeInTheDocument();
  });

  it('the Edit button unlocks too', async () => {
    const { user } = await openRoute();
    await user.click(button(t('editor.edit')));
    expect(await main().findByRole('textbox', { name: 'URI' })).toBeInTheDocument();
  });

  it('e typed inside an input does not unlock, nor e with a modifier', async () => {
    undo.push(overrideDef('routes', { tabs: [PROBE_TAB, GENERAL_TAB] }));
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
    const probe = await main().findByRole('textbox', { name: 'probe' });
    await user.type(probe, 'e');
    expect(probe).toHaveValue('e');
    probe.blur();
    await user.keyboard('{Control>}e{/Control}{Alt>}e{/Alt}{Shift>}e{/Shift}{Meta>}e{/Meta}');
    expect(button(t('editor.edit'))).toBeInTheDocument();
    await user.keyboard('e');
    expect(await main().findByRole('button', { name: t('editor.save') })).toBeInTheDocument();
  });

  it('e typed inside the read-only JSON editor does not unlock', async () => {
    const { user } = await openRoute({}, '#/routes/r1?tab=json');
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    await user.click(editor);
    await user.keyboard('e');
    expect(button(t('editor.edit'))).toBeInTheDocument();
  });

  it('Cmd/Ctrl+S saves when unlocked (without the browser dialog) and does nothing when locked', async () => {
    const { user, admin } = await openRoute();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);
    expect(button(t('editor.edit'))).toBeInTheDocument();

    await unlockAndSetUri(user, '/z');
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(writesOf(admin)).toMatchObject([{ method: 'PUT', path: 'routes/r1', body: { uri: '/z' } }]));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
  });

  // Fix round 1, R3.7: two presses refused in one tick are one refusal.
  it('Cmd/Ctrl+S twice in the same tick with a problem left: one refusal, one toast', async () => {
    undo.push(overrideDef('routes', { validate: (d) => (d.uri === '/bad' ? [{ path: 'uri', message: 'URIs start with /, not /bad' }] : []) }));
    const { user, admin } = await openRoute();
    await unlockAndSetUri(user, '/bad');
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    const refusals = getToasts().filter((item) => item.message === t('editor.fixAnyway', { fix: t('editor.fixOne') }));
    expect(refusals.map((item) => item.count)).toEqual([1]);
    expect(writesOf(admin)).toEqual([]);
  });

  // Task 16b item 12: the second press comes before React has rendered the first one's "saving".
  it('Cmd/Ctrl+S twice in the same tick starts one save', async () => {
    const { user, admin } = await openRoute();
    await unlockAndSetUri(user, '/z');
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toMatchObject([{ method: 'PUT', path: 'routes/r1', body: { uri: '/z' } }]);
  });

  it('shows the status as a badge while locked and as a switch bound to draft.status while editing', async () => {
    const { user, admin } = await openRoute();
    expect(main().getByText(t('table.status.enabled'))).toBeInTheDocument();
    expect(main().queryByRole('switch')).not.toBeInTheDocument();
    await user.keyboard('e');
    const toggle = await main().findByRole('switch', { name: t('table.status.toggle', { name: 'web' }) });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(main().getByText(t('table.status.disabled'))).toBeInTheDocument();
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(writesOf(admin)[0]?.body).toMatchObject({ status: 0 }));
  });
});

describe('save', () => {
  it('Review Focus 1: the PUT body is the loaded route plus the one change, x_future included, no timestamps', async () => {
    const { user, admin } = await openRoute();
    await unlockAndSetUri(user, '/b');
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PUT', path: 'routes/r1', body: { ...stripTimestamps(ROUTE), uri: '/b' } });
  });

  it('after a successful save: locked again, clean, and the baseline is the value the server returns', async () => {
    let written = false;
    const { user } = await openRoute({
      replies: {
        'routes/r1': (req) => {
          if (req.method === 'PUT') written = true;
          else if (written && req.method === 'GET') {
            // APISIX fills defaults in; the editor must show what was stored, not what it sent.
            return json(200, { key: '/apisix/routes/r1', value: { ...(req.body as Obj), ...ROUTE, uri: '/b', priority: 0 }, modifiedIndex: 900 });
          }
          return undefined;
        },
      },
    });
    await unlockAndSetUri(user, '/b');
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
    await user.click(button(t('editor.save')));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(inputsInMain()).toHaveLength(0);
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.saved', { name: 'web' })));
    await user.click(tab('JSON'));
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    expect(editor.textContent).toContain('"priority": 0');
    expect(editor.textContent).not.toContain('update_time');
  });

  it("shows APISIX's 400 verbatim, badges the tab owning the named property and switches to it", async () => {
    const msg = 'invalid configuration: property "uri" validation failed: wrong type: expected string, got number';
    const { user } = await openRoute({ replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(400, { error_msg: msg }) : undefined) } });
    await unlockAndSetUri(user, '/b');
    await user.click(tab('JSON'));
    await user.click(button(t('editor.save')));
    const banner = await main().findByRole('alert');
    expect(within(banner).getByText(msg)).toBeInTheDocument();
    expect(tab(/^General/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^General/)).toHaveAccessibleName(`General ${t('ui.tabs.errors', { count: 1 })}`);
    // The field shows it too, and the page stays unlocked with the draft.
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveAccessibleDescription(msg);
  });

  it('the error banner goes away with Discard', async () => {
    const { user } = await openRoute({ replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(400, { error_msg: 'nope' }) : undefined) } });
    await unlockAndSetUri(user, '/b');
    await user.click(button(t('editor.save')));
    await main().findByRole('alert');
    await user.click(button(t('editor.discard')));
    await user.click(await screen.findByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(main().queryByRole('alert')).not.toBeInTheDocument());
    expect(main().getByText('/a')).toBeInTheDocument();
  });

  it('a refused write for the key role: read-only flag set, message shown, no navigation; then Edit is disabled', async () => {
    const { user } = await openRoute({
      replies: {
        'routes/r1': (req) =>
          req.method === 'PUT' ? json(401, { error_msg: 'failed to check token', description: 'invalid method for role viewer' }) : undefined,
      },
    });
    await unlockAndSetUri(user, '/b');
    await user.click(button(t('editor.save')));
    const banner = await main().findByRole('alert');
    expect(within(banner).getByText('failed to check token: invalid method for role viewer')).toBeInTheDocument();
    expect(screen.getByText(t('readOnly.banner'))).toBeInTheDocument();
    expect(window.location.hash).toBe('#/routes/r1');
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/b');

    await user.click(button(t('editor.discard')));
    await user.click(await screen.findByRole('button', { name: t('editor.leave.confirm') }));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeDisabled();
    await user.keyboard('e');
    expect(inputsInMain()).toHaveLength(0);
  });

  // Task 16b item 11: only a refused write says the key may not write; a refused read says the key is wrong.
  it('a 401 on the read before the write: no write, not read-only; it leads to Connect as a failed query does (asking first)', async () => {
    let gets = 0;
    const { user, admin } = await openRoute({
      replies: {
        'routes/r1': (req) =>
          req.method === 'GET' && ++gets > 1 ? json(401, { error_msg: 'failed to check token', description: 'wrong apikey' }) : undefined,
      },
    });
    await unlockAndSetUri(user, '/b');
    const before = window.history.length;
    await user.click(button(t('editor.save')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    expect(writesOf(admin)).toEqual([]);
    expect(screen.queryByText(t('readOnly.banner'))).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    // Fix round 1, R3.5: Connect replaces the editor's entry, as the query path's redirect does (item 4).
    expect(window.history.length).toBe(before);
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('failed to check token: wrong apikey');
    expect(screen.queryByText(t('readOnly.banner'))).not.toBeInTheDocument();
  });

  it('a 401 on the create check is the same: no write, not read-only, Connect', async () => {
    const { user, admin } = await openEditor('#/upstreams/new', {
      replies: { 'upstreams/u9': (req) => (req.method === 'GET' ? json(401, { error_msg: 'failed to check token', description: 'wrong apikey' }) : undefined) },
    });
    await user.type(await main().findByRole('textbox', { name: /^ID/ }), 'u9');
    await user.click(button(t('editor.create')));
    await user.click(await screen.findByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    expect(writesOf(admin)).toEqual([]);
    expect(screen.queryByText(t('readOnly.banner'))).not.toBeInTheDocument();
  });

  it('nothing changed: Save locks again without writing', async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('editor.save') }));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });
});

describe('issues', () => {
  it('Save with a validate issue on a tab: no API call, that tab becomes active with a badge of 1', async () => {
    undo.push(overrideDef('routes', { validate: (d) => (d.uri === '/bad' ? [{ path: 'uri', message: 'URIs start with /, not /bad' }] : []) }));
    const { user, admin } = await openRoute({}, '#/routes/r1?tab=json');
    await user.keyboard('e');
    await user.click(tab(/^General/));
    await user.clear(await main().findByRole('textbox', { name: 'URI' }));
    await user.type(main().getByRole('textbox', { name: 'URI' }), '/bad');
    await user.click(tab('JSON'));
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') })));
    expect(tab(/^General/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^General/)).toHaveAccessibleName(`General ${t('ui.tabs.errors', { count: 1 })}`);
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveAccessibleDescription('URIs start with /, not /bad');
    expect(writesOf(admin)).toEqual([]);
  });

  it('an issue no tab owns is listed on the JSON tab', async () => {
    undo.push(overrideDef('routes', { validate: () => [{ path: 'x_future.a', message: 'must be 2' }] }));
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('editor.save') }));
    expect(await main().findByRole('tab', { name: `JSON ${t('ui.tabs.errors', { count: 1 })}` })).toHaveAttribute('aria-selected', 'true');
    expect(main().getByText('must be 2')).toBeInTheDocument();
    expect(main().getByText('x_future.a')).toHaveClass('mono');
    expect(writesOf(admin)).toEqual([]);
  });

  it('the validate env carries isNew and the lists', async () => {
    let seen: { isNew: boolean; routes: number } | undefined;
    undo.push(
      overrideDef('routes', {
        validate: (_d, env) => {
          seen = { isNew: env.isNew, routes: env.ctx.routes.length };
          return [];
        },
      }),
    );
    await openRoute();
    await waitFor(() => expect(seen).toEqual({ isNew: false, routes: 1 }));
  });
});

describe('JSON tab', () => {
  it('is the only tab when the kind has none of its own, and edits the whole draft', async () => {
    undo.push(overrideDef('upstreams', { tabs: [], validate: undefined }));
    const { user, admin } = await openEditor('#/upstreams/u1', { objects: { upstreams: [{ id: 'u1', name: 'pool', type: 'roundrobin', nodes: [] }] } });
    await main().findByRole('heading', { level: 1, name: 'pool' });
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(['JSON']);
    await user.keyboard('e');
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Upstream' }) });
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{"name": "pool-2", "type": "chash", "key": "remote_addr", "nodes": [], "id": "u1"}');
    await user.click(button(t('editor.save')));
    await waitFor(() =>
      expect(writesOf(admin)).toEqual([
        { method: 'PUT', path: 'upstreams/u1', body: { name: 'pool-2', type: 'chash', key: 'remote_addr', nodes: [], id: 'u1' } },
      ]),
    );
  });

  it('invalid JSON shows the parser message and disables Save', async () => {
    const { user, admin } = await openRoute({}, '#/routes/r1?tab=json');
    await user.keyboard('e');
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    await user.click(editor);
    await user.keyboard('{Control>}{End}{/Control}x');
    expect(await main().findByText(/^Not valid JSON: /)).toBeInTheDocument();
    expect(button(t('editor.save'))).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(button(t('editor.save'))).toBeEnabled());
    expect(main().queryByText(/^Not valid JSON: /)).not.toBeInTheDocument();
  });

  it('JSON that is not an object is refused the same way', async () => {
    const { user } = await openRoute({}, '#/routes/r1?tab=json');
    await user.keyboard('e');
    await user.click(await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('[1, 2]');
    expect(await main().findByText(t('editor.json.invalid', { error: t('editor.json.notObject') }))).toBeInTheDocument();
    expect(button(t('editor.save'))).toBeDisabled();
  });

  it('a changed id on an existing object blocks the save with an issue', async () => {
    const { user, admin } = await openRoute({}, '#/routes/r1?tab=json');
    await user.keyboard('e');
    await user.click(await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{"id": "r2", "uri": "/a"}');
    await user.click(button(t('editor.save')));
    expect(await main().findByText(t('editor.id.changed', { id: 'r1', kind: 'Route' }))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });

  it('follows changes made in another tab', async () => {
    const { user } = await openRoute();
    await unlockAndSetUri(user, '/from-form');
    await user.click(tab('JSON'));
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    expect(editor.textContent).toContain('"uri": "/from-form"');
  });
});

describe('ID on create', () => {
  it("idMode 'required' with an empty ID: no API call, the ID field shows the problem", async () => {
    const { user, admin } = await openEditor('#/global_rules/new', { objects: { global_rules: [] } });
    await user.click(await main().findByRole('button', { name: t('editor.create') }));
    expect(await main().findByRole('textbox', { name: /^ID/ })).toHaveAccessibleDescription(t('editor.id.required'));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne'));
    expect(writesOf(admin)).toEqual([]);
  });

  it("idMode 'optional' with an empty ID: POST without an id", async () => {
    const { user, admin } = await openEditor(NEW_ROUTE, { objects: { routes: [], upstreams: UPSTREAMS } });
    expect(await main().findByRole('textbox', { name: 'ID' })).toHaveAccessibleDescription(t('editor.id.optional'));
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'POST', path: 'routes', body: { uri: '/*', status: 1, upstream_id: 'u1' } }]));
  });

  it('with an ID: PUT to …/<id>, the id kept out of the body', async () => {
    const { user, admin } = await openEditor(NEW_ROUTE, { objects: { routes: [], upstreams: UPSTREAMS } });
    await user.type(await main().findByRole('textbox', { name: 'ID' }), 'my-route.v2');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/my-route.v2', body: { uri: '/*', status: 1, upstream_id: 'u1' } }]));
  });

  it('a new object starts unlocked, with no Edit button and no menu', async () => {
    await openEditor('#/routes/new', { objects: { routes: [] } });
    expect(await main().findByRole('heading', { level: 1, name: t('page.new', { kind: 'Route' }) })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('editor.edit') })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('editor.more') })).not.toBeInTheDocument();
    expect(main().getByText(t('editor.editing'))).toBeInTheDocument();
  });
});

describe('unsaved changes', () => {
  it('mark the tab whose fields changed, the JSON tab and Save', async () => {
    const { user } = await openRoute();
    const dot = (el: HTMLElement) => el.querySelector('.ed-dot');
    await user.keyboard('e');
    expect(dot(tab(/^General/))).toBeNull();
    expect(dot(button(t('editor.save')))).toBeNull();
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'x');
    expect(dot(tab(/^General/))).not.toBeNull();
    expect(dot(tab('JSON'))).not.toBeNull();
    expect(dot(button(t('editor.save')))).not.toBeNull();
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
  });
});

describe('a background refresh', () => {
  async function renderRoute() {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const user = userEvent.setup();
    const app = renderWithProviders(<EditorPage kind="routes" id="r1" />, { path: '/routes/r1', counts: {}, objects: { routes: [ROUTE] } });
    await screen.findByRole('heading', { level: 1, name: 'web' });
    return { user, ...app };
  }

  it('shows on a locked page', async () => {
    const { admin, queryClient } = await renderRoute();
    admin.touch('routes', 'r1', { uri: '/elsewhere' });
    await queryClient.invalidateQueries();
    expect(await screen.findByText('/elsewhere')).toBeInTheDocument();
  });

  /** Deletes route r1 behind the editor's back (another client), then refetches as a background refresh does. */
  async function deletedElsewhere(admin: Awaited<ReturnType<typeof renderRoute>>['admin'], queryClient: Awaited<ReturnType<typeof renderRoute>>['queryClient']) {
    await admin.fetch('http://apisix.test:9180/apisix/admin/routes/r1', { method: 'DELETE', headers: { 'X-API-KEY': 'k' } });
    await queryClient.invalidateQueries();
  }

  it('that finds the object deleted turns a locked page into Not found (Task 16b, item 127)', async () => {
    const { admin, queryClient } = await renderRoute();
    await deletedElsewhere(admin, queryClient);
    expect(await screen.findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'r1' }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('editor.edit') })).toBeNull();
  });

  it('that finds the object deleted keeps a draft being edited, and says the object is gone; Discard then shows Not found', async () => {
    const { user, admin, queryClient } = await renderRoute();
    await user.keyboard('e');
    await user.type(await screen.findByRole('textbox', { name: 'URI' }), '/mine');
    await deletedElsewhere(admin, queryClient);
    const notice = await screen.findByRole('note', { name: t('editor.removed.title') });
    expect(notice).toHaveTextContent(t('editor.removed.body', { kind: 'Route', name: 'web' }));
    expect(screen.getByRole('textbox', { name: 'URI' })).toHaveValue('/a/mine');
    await user.click(screen.getByRole('button', { name: t('editor.discard') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.leave.confirm') }));
    expect(await screen.findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'r1' }) })).toBeInTheDocument();
  });

  it('that finds a plugin metadata entry deleted turns its locked page into the create form, not "stored meanwhile"', async () => {
    const { admin, queryClient } = renderWithProviders(<EditorPage kind="plugin_metadata" id="azure-functions" />, {
      path: '/plugin_metadata/azure-functions',
      counts: {},
      objects: { plugin_metadata: [{ id: 'azure-functions', master_apikey: 'k1' }] },
    });
    expect(await screen.findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    await admin.fetch('http://apisix.test:9180/apisix/admin/plugin_metadata/azure-functions', { method: 'DELETE', headers: { 'X-API-KEY': 'k' } });
    await queryClient.invalidateQueries();
    expect(await screen.findByRole('button', { name: t('editor.create') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('editor.edit') })).toBeNull();
    expect(screen.queryByRole('note', { name: t('editor.foundMeanwhile.title') })).toBeNull();
  });

  it('never replaces a draft being edited (the save reports the conflict instead)', async () => {
    const { user, admin, queryClient } = await renderRoute();
    await user.keyboard('e');
    await user.type(await screen.findByRole('textbox', { name: 'URI' }), '/mine');
    admin.touch('routes', 'r1', { uri: '/elsewhere' });
    await queryClient.invalidateQueries();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('textbox', { name: 'URI' })).toHaveValue('/a/mine');
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    expect(await screen.findByRole('dialog', { name: t('editor.conflict.title', { kind: 'Route', name: 'web' }) })).toBeInTheDocument();
  });
});

/** A promise to hold a request with, and its release. */
function gate() {
  let open = () => {};
  const promise = new Promise<undefined>((resolve) => {
    open = () => resolve(undefined);
  });
  return { promise, open };
}

describe('a save in flight', () => {
  it('locks the tab area, disables Discard and Delete, and lands on the saved value', async () => {
    const held = gate();
    const { user, admin } = await openRoute({ replies: { 'routes/r1': (req) => (req.method === 'PUT' ? held.promise : undefined) } });
    await unlockAndSetUri(user, '/b');
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    // Nothing can be typed while the request is out: the fields read as text.
    expect(inputsInMain()).toHaveLength(0);
    expect(main().getByText('/b')).toBeInTheDocument();
    expect(button(t('editor.discard'))).toBeDisabled();
    expect(button(t('editor.save'))).toHaveAttribute('aria-busy', 'true');
    await user.click(button(t('editor.more')));
    expect(await screen.findByRole('menuitem', { name: t('action.delete') })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');

    held.open();
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(main().getByText('/b')).toBeInTheDocument();
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
  });

  it('a create that finishes after the page was left does not navigate back to it', async () => {
    const held = gate();
    const { user, admin } = await openEditor(NEW_ROUTE, {
      objects: { routes: [], upstreams: UPSTREAMS },
      replies: { 'routes/late': (req) => (req.method === 'PUT' ? held.promise : undefined) },
    });
    await user.type(await main().findByRole('textbox', { name: 'ID' }), 'late');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(button(t('editor.discard'))).toBeDisabled();
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe('#/upstreams'));

    held.open();
    await waitFor(() => expect(admin.stored('routes')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/upstreams');
  });
});

describe('the draft while locked', () => {
  const FORCE_TAB: TabDef = {
    id: 'force',
    label: 'Force',
    fields: ['uri'],
    render: (p) => (
      <button type="button" onClick={() => p.setDraft({ ...p.draft, uri: '/forced' })}>
        force
      </button>
    ),
  };

  it('cannot change: setDraft does nothing until Edit', async () => {
    undo.push(overrideDef('routes', { tabs: [FORCE_TAB, GENERAL_TAB] }));
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
    await user.click(await main().findByRole('button', { name: 'force' }));
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: 'force' }));
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
  });
});

describe('text in the JSON tab that does not parse', () => {
  async function brokenJson() {
    const app = await openRoute({}, '#/routes/r1?tab=json');
    await app.user.keyboard('e');
    await app.user.click(await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) }));
    await app.user.keyboard('{Control>}{End}{/Control},');
    await main().findByText(/^Not valid JSON: /);
    return app;
  }

  it('counts as unsaved: Discard asks, then the locked view shows the stored object again', async () => {
    const { user } = await brokenJson();
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
    await user.click(button(t('editor.discard')));
    await user.click(await screen.findByRole('button', { name: t('editor.leave.confirm') }));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(main().queryByText(/^Not valid JSON: /)).not.toBeInTheDocument();
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    expect(editor.textContent).not.toMatch(/},$/);
    await user.keyboard('e');
    expect(await main().findByRole('button', { name: t('editor.save') })).toBeEnabled();
  });

  it('counts as unsaved: leaving the page asks', async () => {
    const { user } = await brokenJson();
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.leave.title') })).toBeInTheDocument();
  });
});

describe('APISIX errors about plugins', () => {
  it('go to the plugin, never to a route field of the same name', async () => {
    const msg = 'failed to check the configuration of plugin proxy-rewrite err: property "uri" validation failed: wrong type: expected string, got number';
    const PLUGINS_TAB: TabDef = { id: 'plugins', label: 'Plugins', fields: ['plugins'], render: (p) => <p>{p.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}</p> };
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB, PLUGINS_TAB] }));
    const { user } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? json(400, { error_msg: msg }) : undefined) },
    });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await unlockAndSetUri(user, '/b');
    await user.click(button(t('editor.save')));
    expect(within(await main().findByRole('alert')).getByText(msg)).toBeInTheDocument();
    expect(tab(/^Plugins/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Plugins/)).toHaveAccessibleName(`Plugins ${t('ui.tabs.errors', { count: 1 })}`);
    expect(main().getByText(`plugins.proxy-rewrite: ${msg}`)).toBeInTheDocument();
    expect(tab(/^General/)).toHaveAccessibleName('General');
  });
});

describe('kinds whose id is a field of the body (consumers: username)', () => {
  it('create with PUT …/<username>, and land on the new consumer', async () => {
    const { user, admin } = await openEditor('#/consumers/new?tab=json', { objects: { consumers: [] } });
    await main().findByRole('button', { name: t('editor.create') });
    expect(main().queryByRole('textbox', { name: /^ID/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Consumer' }) }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{"username": "jo", "desc": "Jo"}');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumers/jo', body: { username: 'jo', desc: 'Jo' } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/consumers/jo'));
  });

  it('a stored consumer cannot be renamed', async () => {
    const { user, admin } = await openEditor('#/consumers/jo?tab=json', { objects: { consumers: [{ username: 'jo' }] } });
    await main().findByRole('heading', { level: 1, name: 'jo' });
    await user.keyboard('e');
    await user.click(await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Consumer' }) }));
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{"username": "bob"}');
    await user.click(button(t('editor.save')));
    expect(await main().findByText(t('editor.id.changed', { id: 'jo', kind: 'Consumer' }))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });
});
