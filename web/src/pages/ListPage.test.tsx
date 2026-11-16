import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { json, type FakeAdminOptions } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const ROUTES: Obj[] = [
  { id: 'r1', name: 'alpha', uri: '/a', upstream_id: 'u1', status: 1 },
  { id: 'r2', name: 'beta', uri: '/b', upstream_id: 'u1' },
  { id: 'r3', name: 'gamma', uri: '/c', status: 0 },
];

/** The app at `hash`, once the shell's main area is there. */
async function open(hash: string, opts: FakeAdminOptions = {}) {
  saveConnections([DEV_CONN], DEV_CONN.id);
  const user = userEvent.setup();
  const app = renderApp({ hash, counts: {}, objects: { routes: ROUTES, upstreams: [{ id: 'u1', name: 'backend' }] }, ...opts });
  await screen.findByRole('main');
  return { user, ...app };
}

const main = () => within(screen.getByRole('main'));
const rowOf = async (name: string) => (await main().findByRole('link', { name })).closest('tr') as HTMLElement;
const requestsTo = (admin: Awaited<ReturnType<typeof open>>['admin'], method: string) =>
  admin.requests.filter((r) => r.method === method).map((r) => ({ path: r.url.pathname.replace(/^.*\/apisix\/admin\//, ''), body: r.body }));

async function rowAction(user: ReturnType<typeof userEvent.setup>, name: string, action: string) {
  const row = await rowOf(name);
  await user.click(within(row).getByRole('button', { name: t('table.actionsFor', { name }) }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

describe('ListPage', () => {
  it('shows the plural name with the count, and every row', async () => {
    await open('#/routes');
    expect(await main().findByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeInTheDocument();
    await main().findByRole('link', { name: 'gamma' });
    expect(main().getByText('3', { selector: '.list-title__count' })).toBeInTheDocument();
    expect(main().getAllByRole('link', { name: /^(alpha|beta|gamma)$/ })).toHaveLength(3);
  });

  it('with zero items shows the empty state and a Create link to #/<kind>/~new', async () => {
    await open('#/protos');
    const empty = await main().findByRole('region', { name: t('table.empty.title', { plural: t('kind.protos.plural') }) });
    expect(within(empty).getByRole('link', { name: t('page.new', { kind: t('kind.protos.singular') }) })).toHaveAttribute(
      'href',
      '#/protos/~new',
    );
  });

  it('Edit opens the editor and Duplicate the create page with ?from=<encoded id>', async () => {
    // An id with a slash names no object since fix round 2 (R4); one with a space still needs encoding.
    const { user } = await open('#/routes', { objects: { routes: [{ id: 'a b', name: 'slashy' }] } });
    await rowAction(user, 'slashy', t('action.duplicate'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/~new?from=a%20b'));
    window.history.back();
    // The copy is unsaved work (a duplicate starts dirty), so leaving it asks first.
    await user.click(await screen.findByRole('button', { name: t('editor.leave.confirm') }));
    await rowAction(user, 'slashy', t('action.edit'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/a%20b'));
  });

  it('View JSON shows the stored value, pretty-printed, and copies it', async () => {
    const { user } = await open('#/routes');
    await rowAction(user, 'alpha', t('action.viewJson'));
    const dialog = await screen.findByRole('dialog', { name: t('json.title', { kind: t('kind.routes.singular'), name: 'alpha' }) });
    const text = JSON.stringify(ROUTES[0], null, 2);
    expect(await within(dialog).findByRole('textbox', { name: t('json.title', { kind: t('kind.routes.singular'), name: 'alpha' }) })).toHaveTextContent(
      '"upstream_id": "u1"',
    );
    await user.click(within(dialog).getByRole('button', { name: t('json.copy') }));
    expect(await navigator.clipboard.readText()).toBe(text);
    expect(await screen.findByText(t('json.copied'))).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('lists the objects that use an upstream before deleting it', async () => {
    const { user } = await open('#/upstreams');
    await rowAction(user, 'backend', t('action.delete'));
    const dialog = await screen.findByRole('alertdialog', {
      name: t('delete.title', { kind: t('kind.upstreams.singular'), name: 'backend', id: 'u1' }),
    });
    expect(within(dialog).getByText(t('delete.inUse'))).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /alpha/ })).toHaveAttribute('href', '#/routes/r1');
    expect(within(dialog).getByRole('link', { name: /beta/ })).toHaveAttribute('href', '#/routes/r2');
    expect(within(dialog).queryByRole('link', { name: /gamma/ })).not.toBeInTheDocument();
  });

  // Fix round 1, R1.5: the single dialog waits for the lists what uses it comes from, for every kind.
  it('says checking… while a list what uses an upstream comes from loads, then the users', async () => {
    let release = () => {};
    const gate = new Promise<undefined>((done) => (release = () => done(undefined)));
    const { user } = await open('#/upstreams', { replies: { routes: () => gate } });
    await rowAction(user, 'backend', t('action.delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(t('delete.checking'))).toBeInTheDocument();
    expect(within(dialog).queryByText(t('delete.inUse'))).not.toBeInTheDocument();
    act(() => release());
    expect(await within(dialog).findByText(t('delete.inUse'))).toBeInTheDocument();
    expect(within(dialog).queryByText(t('delete.checking'))).not.toBeInTheDocument();
  });

  it('says which list could not be read when one failed: unknown, never "in use by none"', async () => {
    const { user } = await open('#/upstreams', { replies: { global_rules: () => json(500, { error_msg: 'etcd down' }) } });
    await rowAction(user, 'backend', t('action.delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText(t('delete.unknown', { lists: t('kind.global_rules.plural') }))).toBeInTheDocument();
    expect(within(dialog).queryByText(t('delete.inUse'))).not.toBeInTheDocument();
  });

  it('confirming removes the object, and its row goes once the list is reloaded', async () => {
    const { user, admin } = await open('#/routes');
    await rowAction(user, 'gamma', t('action.delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(t('delete.inUse'))).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.routes.singular') }) }));
    await waitFor(() => expect(main().queryByRole('link', { name: 'gamma' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requestsTo(admin, 'DELETE')).toEqual([{ path: 'routes/r3', body: undefined }]);
    expect(await screen.findByText(t('delete.done', { name: 'gamma' }))).toBeInTheDocument();
  });

  it("keeps the dialog open with APISIX's message when it refuses", async () => {
    const refusal = 'can not delete this upstream, route [r1] is still using it now';
    const { user } = await open('#/upstreams', {
      replies: { 'upstreams/u1': (req) => (req.method === 'DELETE' ? json(400, { error_msg: refusal }) : undefined) },
    });
    await rowAction(user, 'backend', t('action.delete'));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.upstreams.singular') }) }));
    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // Still listed (behind the modal dialog, so outside the accessibility tree for now).
    expect(main().getByRole('link', { name: 'backend', hidden: true })).toBeInTheDocument();
  });
});

describe('status', () => {
  const toggle = (name: string) => main().findByRole('switch', { name: t('table.status.toggle', { name }) });

  it('a status column comes first, with a switch and a text badge', async () => {
    await open('#/routes');
    const headers = (await main().findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.filter(Boolean)[0]).toMatch(new RegExp(`^${t('table.status')}`));
    expect(await toggle('alpha')).toBeChecked();
    expect(await toggle('beta')).toBeChecked(); // no status means enabled
    expect(await toggle('gamma')).not.toBeChecked();
    expect(within(await rowOf('gamma')).getByText(t('table.status.disabled'))).toBeInTheDocument();
    expect(within(await rowOf('alpha')).getByText(t('table.status.enabled'))).toBeInTheDocument();
  });

  it('PATCHes {status: 0} and stays off once the list is reloaded', async () => {
    const { user, admin } = await open('#/routes');
    await user.click(await toggle('alpha'));
    expect(await toggle('alpha')).not.toBeChecked();
    await waitFor(() => expect(requestsTo(admin, 'PATCH')).toEqual([{ path: 'routes/r1', body: { status: 0 } }]));
    // The reload after the write brings the stored value back: still off.
    await waitFor(() => expect(admin.requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/routes')).length).toBeGreaterThan(1));
    expect(await toggle('alpha')).not.toBeChecked();
    await user.click(await toggle('alpha'));
    await waitFor(() => expect(requestsTo(admin, 'PATCH').at(-1)).toEqual({ path: 'routes/r1', body: { status: 1 } }));
    await waitFor(async () => expect(await toggle('alpha')).toBeChecked());
  });

  it('rolls back and shows the error when the write is rejected', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user, admin } = await open('#/routes', {
      replies: {
        'routes/r1': (req) => (req.method === 'PATCH' ? gate.then(() => json(500, { error_msg: 'etcd down' })) : undefined),
      },
    });
    await user.click(await toggle('alpha'));
    // Optimistic: off before APISIX answers.
    expect(await toggle('alpha')).not.toBeChecked();
    expect(within(await rowOf('alpha')).getByText(t('table.status.disabled'))).toBeInTheDocument();
    expect(requestsTo(admin, 'PATCH')).toEqual([{ path: 'routes/r1', body: { status: 0 } }]);
    release();
    await waitFor(async () => expect(await toggle('alpha')).toBeChecked());
    expect(await screen.findByText('etcd down')).toBeInTheDocument();
  });

  it('bulk Disable on three selected routes sends three PATCHes with {status: 0}', async () => {
    const { user, admin } = await open('#/routes');
    await main().findByRole('link', { name: 'gamma' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
    await user.click(main().getByRole('button', { name: t('action.disable') }));
    await waitFor(() => expect(requestsTo(admin, 'PATCH')).toHaveLength(3));
    expect(requestsTo(admin, 'PATCH')).toEqual([
      { path: 'routes/r1', body: { status: 0 } },
      { path: 'routes/r2', body: { status: 0 } },
      { path: 'routes/r3', body: { status: 0 } },
    ]);
    expect(await screen.findByText(t('bulk.done', { action: t('action.disable'), done: 3 }))).toBeInTheDocument();
    await waitFor(async () => expect(await toggle('alpha')).not.toBeChecked());
  });

  it('bulk Delete confirms with the count and names, and reports failures by name', async () => {
    const { user, admin } = await open('#/routes', {
      replies: { 'routes/r2': (req) => (req.method === 'DELETE' ? json(400, { error_msg: 'in use' }) : undefined) },
    });
    await main().findByRole('link', { name: 'gamma' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
    await user.click(main().getByRole('button', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('bulk.delete.title', { count: 3, plural: t('kind.routes.plural') }) });
    expect(within(dialog).getByText('alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('gamma')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('bulk.delete.confirm', { count: 3 }) }));
    await waitFor(() => expect(requestsTo(admin, 'DELETE')).toHaveLength(3));
    expect(
      await screen.findByText(t('bulk.someFailed', { action: t('action.delete'), done: 2, failed: 1, names: 'beta', error: 'in use' })),
    ).toBeInTheDocument();
    await waitFor(() => expect(main().queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument());
    expect(main().getByRole('link', { name: 'beta' })).toBeInTheDocument();
  });

  // Final wave G2: the bulk confirmation shows what uses each selected object, as the single dialog does.
  describe('bulk Delete names what uses each selected object', () => {
    const UPSTREAMS = [{ id: 'u1', name: 'backend' }, { id: 'u2', name: 'spare' }, { id: 'u3', name: 'split-target' }];
    const RULES = [{ id: 'g1', plugins: { 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'u3' }] }] } } }];
    const selectAll = async (user: ReturnType<typeof userEvent.setup>) => {
      await main().findByRole('link', { name: 'spare' });
      await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
      await user.click(main().getByRole('button', { name: t('action.delete') }));
      return screen.findByRole('alertdialog', { name: t('bulk.delete.title', { count: 3, plural: t('kind.upstreams.plural') }) });
    };

    it('each object in use is named with its users, linked; one in use by none is not', async () => {
      const { user } = await open('#/upstreams', { objects: { routes: ROUTES, upstreams: UPSTREAMS, global_rules: RULES } });
      const dialog = await selectAll(user);
      const backend = await within(dialog).findByRole('group', { name: 'backend' });
      expect(within(backend).getByText(t('delete.inUse'))).toBeInTheDocument();
      expect(within(backend).getByRole('link', { name: /alpha/ })).toHaveAttribute('href', '#/routes/r1');
      expect(within(backend).getByRole('link', { name: /beta/ })).toHaveAttribute('href', '#/routes/r2');
      const split = within(dialog).getByRole('group', { name: 'split-target' });
      expect(within(split).getByRole('link', { name: /g1/ })).toHaveAttribute('href', '#/global_rules/g1');
      expect(within(dialog).queryByRole('group', { name: 'spare' })).not.toBeInTheDocument();
    });

    it('says checking… while a list they come from loads, then the users, the dialog still open', async () => {
      let release = () => {};
      const gate = new Promise<undefined>((done) => (release = () => done(undefined)));
      const { user } = await open('#/upstreams', { objects: { routes: ROUTES, upstreams: UPSTREAMS, global_rules: RULES }, replies: { routes: () => gate } });
      const dialog = await selectAll(user);
      expect(within(dialog).getByText(t('bulk.delete.checking'))).toBeInTheDocument();
      expect(within(dialog).queryByRole('group')).not.toBeInTheDocument();
      act(() => release());
      const backend = await within(dialog).findByRole('group', { name: 'backend' });
      expect(within(backend).getByRole('link', { name: /alpha/ })).toBeInTheDocument();
      expect(within(dialog).queryByText(t('bulk.delete.checking'))).not.toBeInTheDocument();
    });

    it('says which list could not be read when one failed: unknown, never "in use by none"', async () => {
      const { user } = await open('#/upstreams', {
        objects: { routes: ROUTES, upstreams: UPSTREAMS },
        replies: { global_rules: () => json(500, { error_msg: 'etcd down' }) },
      });
      const dialog = await selectAll(user);
      expect(await within(dialog).findByText(t('bulk.delete.unknown', { lists: t('kind.global_rules.plural') }))).toBeInTheDocument();
      expect(within(dialog).queryByText(t('bulk.delete.checking'))).not.toBeInTheDocument();
    });
  });

  // Task 16b item 13: a key refused once is refused for the rest.
  it('a bulk action stops at the first write refused for the key, and says how many were done', async () => {
    const { user, admin } = await open('#/routes', {
      replies: { 'routes/r2': (req) => (req.method === 'PATCH' ? json(401, { error_msg: 'invalid method for role viewer' }) : undefined) },
    });
    await main().findByRole('link', { name: 'gamma' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
    await user.click(main().getByRole('button', { name: t('action.disable') }));
    expect(
      await screen.findByText(t('bulk.stopped', { action: t('action.disable'), done: 1, total: 3, error: 'invalid method for role viewer' })),
    ).toBeInTheDocument();
    expect(requestsTo(admin, 'PATCH')).toEqual([
      { path: 'routes/r1', body: { status: 0 } },
      { path: 'routes/r2', body: { status: 0 } },
    ]);
    expect(await screen.findByText(t('readOnly.banner'))).toBeInTheDocument();
  });

  // Fix round 1, R3.1: an item that failed for another reason before the key was refused is named too.
  it('stopped by a refused key after an item failed for another reason: both are said', async () => {
    const { user } = await open('#/routes', {
      replies: {
        'routes/r1': (req) => (req.method === 'PATCH' ? json(400, { error_msg: 'in use' }) : undefined),
        'routes/r2': (req) => (req.method === 'PATCH' ? json(401, { error_msg: 'invalid method for role viewer' }) : undefined),
      },
    });
    await main().findByRole('link', { name: 'gamma' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
    await user.click(main().getByRole('button', { name: t('action.disable') }));
    expect(
      await screen.findByText(
        t('bulk.stoppedAfterFailures', { action: t('action.disable'), done: 0, total: 3, failed: 1, names: 'alpha', reason: 'in use', error: 'invalid method for role viewer' }),
      ),
    ).toBeInTheDocument();
  });
});

// Fix round 1, R1: a confirm opened from a row's menu gives focus back to that row, or to the table when the row went.
describe('focus after a row action confirm', () => {
  const actionsOf = async (name: string) => within(await rowOf(name)).getByRole('button', { name: t('table.actionsFor', { name }) });
  const deleteDialog = () => screen.findByRole('alertdialog');

  it("Cancel: back on the row's ⋯", async () => {
    const { user } = await open('#/routes');
    await rowAction(user, 'beta', t('action.delete'));
    await user.click(within(await deleteDialog()).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(async () => expect(await actionsOf('beta')).toHaveFocus());
  });

  it("a confirmed delete: the table's first row action; with no row left, the list's heading", async () => {
    const { user } = await open('#/routes', { objects: { routes: ROUTES.slice(0, 2), upstreams: [{ id: 'u1', name: 'backend' }] } });
    await rowAction(user, 'beta', t('action.delete'));
    const dialog = await deleteDialog();
    await user.click(within(dialog).getAllByRole('button').find((b) => b.textContent?.startsWith('Delete')) as HTMLElement);
    await waitFor(() => expect(main().queryByRole('link', { name: 'beta' })).not.toBeInTheDocument());
    await waitFor(async () => expect(await actionsOf('alpha')).toHaveFocus());
    await rowAction(user, 'alpha', t('action.delete'));
    await user.click(within(await deleteDialog()).getAllByRole('button').find((b) => b.textContent?.startsWith('Delete')) as HTMLElement);
    await waitFor(() => expect(main().getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toHaveFocus());
  });

  it("the editor's ⋯ → Delete → Cancel: back on the editor's ⋯", async () => {
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'alpha' });
    const more = main().getByRole('button', { name: t('editor.more') });
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    await user.click(within(await deleteDialog()).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(more).toHaveFocus());
  });
});

// Task 16b item 38: the list page itself, its search and its filters over rows of odd shapes.
describe('rows of odd shapes', () => {
  it('the routes list shows every row, and searching them throws nothing', async () => {
    const odd: Obj[] = [
      { id: 'o1', name: 'one', desc: 5 },
      { id: 'o2', name: 'two', labels: 'x' },
      { id: 'o3', name: 'three', plugins: null },
      { id: 'o4', name: 'four', methods: 'GET', hosts: 'a', uris: 7 },
    ];
    const { user } = await open('#/routes', { objects: { routes: odd, upstreams: [] } });
    for (const name of ['one', 'two', 'three', 'four']) expect(await main().findByRole('link', { name })).toBeInTheDocument();
    expect(screen.queryByText(t('error.title'))).not.toBeInTheDocument();
    await user.type(main().getByRole('searchbox'), 'GET');
    await waitFor(() => expect(main().queryByRole('link', { name: 'one' })).not.toBeInTheDocument());
    expect(screen.queryByText(t('error.title'))).not.toBeInTheDocument();
  });
});

// Task 16b item 72: a list's search reads each object as its locked view shows it, so no secret finds it.
describe('search never finds an object by a secret it holds', () => {
  const search = async (user: ReturnType<typeof userEvent.setup>, kindPlural: string, text: string) => {
    const box = main().getByRole('searchbox', { name: t('table.search.label', { plural: kindPlural }) });
    await user.clear(box);
    await user.type(box, text);
  };

  it.each([
    ['consumers', { username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: 'jo-stored-key' } } }, 'jo-stored-key', 'Jo'],
    ['routes', { id: 'r9', name: 'login', uri: '/login', plugins: { 'basic-auth': {}, 'limit-count': { count: 1, time_window: 1, redis_password: 'redis-stored-pass' } } }, 'redis-stored-pass', 'login'],
    ['upstreams', { id: 'u9', name: 'mtls', nodes: [], tls: { client_cert: 'CERT', client_key: 'AES-stored-ciphertext' } }, 'AES-stored', 'mtls'],
    ['services', { id: 's9', name: 'svc', password: 'svc-stored-pass' }, 'svc-stored-pass', 'svc'],
  ] as const)('%s', async (kind, value, secret, visible) => {
    const { user } = await open(`#/${kind}`, { objects: { [kind]: [value] } });
    const plural = t(`kind.${kind}.plural`);
    const name = 'username' in value ? value.username : value.name;
    expect(await main().findByRole('link', { name })).toBeInTheDocument();
    await search(user, plural, secret);
    await waitFor(() => expect(main().queryByRole('link', { name })).not.toBeInTheDocument());
    await search(user, plural, visible);
    expect(await main().findByRole('link', { name })).toBeInTheDocument();
  });
});

// Fix round 1, R2: what a search finds does not depend on which pages were visited first.
describe('search through plugin settings', () => {
  const searchbox = (plural: string) => main().getByRole('searchbox', { name: t('table.search.label', { plural }) });

  it("loads the plugin list once a search is typed: a plugin setting is found, key-auth's key (an encrypt field, not named like a secret) never", async () => {
    const consumers: Obj[] = [{ username: 'jo', plugins: { 'key-auth': { key: 'jo-stored-key' }, 'proxy-rewrite': { uri: '/rewritten-path' } } }];
    const { user, admin } = await open('#/consumers', { objects: { consumers }, replies: pluginReplies() });
    expect(await main().findByRole('link', { name: 'jo' })).toBeInTheDocument();
    expect(admin.requests.some((r) => r.url.pathname.endsWith('/plugins'))).toBe(false);
    await user.type(searchbox(t('kind.consumers.plural')), 'rewritten-path');
    expect(await main().findByRole('link', { name: 'jo' })).toBeInTheDocument();
    expect(admin.requests.some((r) => r.url.pathname.endsWith('/plugins'))).toBe(true);
    await user.clear(searchbox(t('kind.consumers.plural')));
    await user.type(searchbox(t('kind.consumers.plural')), 'jo-stored-key');
    await waitFor(() => expect(main().queryByRole('link', { name: 'jo' })).not.toBeInTheDocument());
  });

  it('while the plugin list loads it says it is still looking, not "No … match"; then it finds the row', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const routes: Obj[] = [{ id: 'r9', name: 'login', uri: '/login', plugins: { 'proxy-rewrite': { uri: '/rewritten-path' } } }];
    const { user } = await open('#/routes', {
      objects: { routes },
      replies: {
        plugins: async (req) => {
          await gate;
          return pluginReplies().plugins?.(req) as Response;
        },
      },
    });
    await main().findByRole('link', { name: 'login' });
    await user.type(searchbox(t('kind.routes.plural')), 'rewritten-path');
    expect(await main().findByText(t('table.search.plugins'))).toBeInTheDocument();
    expect(main().queryByText(t('table.empty.noMatch', { plural: t('kind.routes.plural') }))).not.toBeInTheDocument();
    release();
    expect(await main().findByRole('link', { name: 'login' })).toBeInTheDocument();
    expect(main().queryByText(t('table.search.plugins'))).not.toBeInTheDocument();
  });
});

// Fix round 2, R1.4: a plugin list that cannot be loaded is said next to the result, with a retry.
describe('search when the plugin list cannot be loaded', () => {
  it('says plugin settings could not be searched, with the error and Try again; a retry that works finds the row', async () => {
    let calls = 0;
    const routes: Obj[] = [{ id: 'r9', name: 'login', uri: '/login', plugins: { 'proxy-rewrite': { uri: '/rewritten-path' } } }];
    const { user } = await open('#/routes', {
      objects: { routes },
      replies: { plugins: (req) => (++calls === 1 ? json(500, { error_msg: 'etcd down' }) : pluginReplies().plugins?.(req)) },
    });
    await main().findByRole('link', { name: 'login' });
    await user.type(main().getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.routes.plural') }) }), 'rewritten-path');
    const note = await main().findByText(t('table.search.pluginsFailed', { error: 'HTTP 500: etcd down' }));
    expect(main().getByText(t('table.empty.noMatch', { plural: t('kind.routes.plural') }))).toBeInTheDocument();
    await user.click(within(note.closest('[role="status"]') as HTMLElement).getByRole('button', { name: t('table.retry') }));
    expect(await main().findByRole('link', { name: 'login' })).toBeInTheDocument();
    expect(main().queryByText(t('table.search.pluginsFailed', { error: 'HTTP 500: etcd down' }))).not.toBeInTheDocument();
  });
});

describe('read-only key', () => {
  it('a rejected write shows the error, marks the key read-only with a banner, and stays on the page', async () => {
    const { user } = await open('#/routes', {
      replies: {
        'routes/r1': (req) => (req.method === 'PATCH' ? json(401, { error_msg: 'invalid method for role viewer' }) : undefined),
      },
    });
    expect(screen.queryByText(t('readOnly.banner'))).not.toBeInTheDocument();
    await user.click(await toggle('alpha'));
    expect(await screen.findByText('invalid method for role viewer')).toBeInTheDocument();
    expect(await screen.findByText(t('readOnly.banner'))).toBeInTheDocument();
    // Known item 1: once the key is read-only, the status is the badge alone, with no switch.
    await waitFor(() => expect(main().queryByRole('switch', { name: t('table.status.toggle', { name: 'alpha' }) })).not.toBeInTheDocument());
    expect(main().queryAllByRole('switch', { name: /enabled$/ })).toHaveLength(0);
    expect(within(await rowOf('alpha')).getByText(t('table.status.enabled'))).toBeInTheDocument();
    expect(within(await rowOf('gamma')).getByText(t('table.status.disabled'))).toBeInTheDocument();
    expect(window.location.hash).toBe('#/routes');
    // Nothing it leads to could be saved: no New.
    expect(main().queryByRole('link', { name: t('page.new', { kind: t('kind.routes.singular') }) })).not.toBeInTheDocument();
    // The banner stays on other pages of the same connection.
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    expect(await main().findByRole('heading', { level: 1, name: t('kind.upstreams.plural') })).toBeInTheDocument();
    expect(screen.getByText(t('readOnly.banner'))).toBeInTheDocument();
    // An empty list (known item 12) still says what the kind is for, without the New button.
    await user.click(screen.getByRole('link', { name: /^Protos/ }));
    const empty = await main().findByRole('region', { name: t('table.empty.title', { plural: t('kind.protos.plural') }) });
    expect(within(empty).getByText(t('kind.protos.about'))).toBeInTheDocument();
    expect(within(empty).queryByRole('link')).not.toBeInTheDocument();
  });

  // Fix round 1, R3: Duplicate goes where New goes; both come back on a connection whose key can write.
  it('a read-only key: no Duplicate in the row menu or the editor menu; another connection has them again', async () => {
    const prod = { id: 'prod', name: 'prod', baseUrl: 'https://prod.test:9180', key: 'k' };
    saveConnections([DEV_CONN, prod], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({
      hash: '#/routes',
      counts: {},
      objects: { routes: ROUTES, upstreams: [{ id: 'u1', name: 'backend' }] },
      replies: { 'routes/r1': (req) => (req.method === 'PATCH' && req.url.origin === 'http://apisix.test:9180' ? json(401, { error_msg: 'invalid method for role viewer' }) : undefined) },
    });
    await screen.findByRole('main');
    const rowMenu = async (name: string) => {
      await user.click(within(await rowOf(name)).getByRole('button', { name: t('table.actionsFor', { name }) }));
      const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
      await user.keyboard('{Escape}');
      return items;
    };
    expect(await rowMenu('beta')).toContain(t('action.duplicate'));
    await user.click(await toggle('alpha'));
    expect(await screen.findByText(t('readOnly.banner'))).toBeInTheDocument();
    expect(await rowMenu('beta')).not.toContain(t('action.duplicate'));
    // The editor's ⋯ menu.
    await user.click(main().getByRole('link', { name: 'beta' }));
    await main().findByRole('heading', { level: 1, name: 'beta' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).not.toContain(t('action.duplicate'));
    await user.keyboard('{Escape}');
    // Another connection, whose key can write: both are back.
    await user.click(screen.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: /prod/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Connection: prod/ })).toBeInTheDocument());
    expect(screen.queryByText(t('readOnly.banner'))).not.toBeInTheDocument();
    expect(await rowMenu('beta')).toContain(t('action.duplicate'));
    await user.click(main().getByRole('link', { name: 'beta' }));
    await main().findByRole('heading', { level: 1, name: 'beta' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toContain(t('action.duplicate'));
  });

  async function toggle(name: string) {
    return main().findByRole('switch', { name: t('table.status.toggle', { name }) });
  }
});

describe('group by host', () => {
  const DAY = 86_400_000;
  const objects = {
    routes: [
      { id: 'r1', name: 'both', hosts: ['b.example', 'a.example'] },
      { id: 'r2', name: 'only-a', host: 'a.example' },
      { id: 'r3', name: 'anywhere', uri: '/*' },
    ],
    ssls: [{ id: 'c1', snis: ['a.example'], validity_end: Math.floor((Date.now() + 10 * DAY) / 1000) }],
  };
  const groupSwitch = () => main().findByRole('switch', { name: t('group.byHost') });
  /** Group headers and route names, top to bottom. */
  const layout = () =>
    within(main().getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) => {
        const head = within(row).queryByRole('rowheader');
        return head ? `# ${head.textContent}` : (row.querySelector('.tbl-name')?.textContent ?? '');
      });

  it('lists a route under each of its hosts, host-less ones under (any host), and keeps the choice', async () => {
    const { user, unmount } = await open('#/routes', { objects });
    await main().findByRole('link', { name: 'anywhere' });
    expect(main().queryByRole('rowheader')).not.toBeInTheDocument();
    expect(await groupSwitch()).not.toBeChecked();

    await user.click(await groupSwitch());
    expect(await groupSwitch()).toBeChecked();
    expect(localStorage.getItem('apiseven.table.routes.group')).toBe('host');
    const heads = layout().filter((line) => line.startsWith('# '));
    expect(heads).toHaveLength(3);
    expect(heads[0]).toMatch(/^# a\.example2/);
    expect(heads[1]).toMatch(/^# b\.example1/);
    expect(heads[2]).toBe(`# ${t('group.anyHost')}1`);
    expect(layout().filter((line) => !line.startsWith('# '))).toEqual(['both', 'only-a', 'both', 'anywhere']);

    // Remounted (a reload): still grouped.
    unmount();
    await open('#/routes', { objects });
    expect(await groupSwitch()).toBeChecked();
    await main().findByRole('link', { name: 'anywhere' });
    expect(main().getAllByRole('rowheader')).toHaveLength(3);
  });

  it("heads a host's group with its certificate expiry", async () => {
    const { user } = await open('#/routes', { objects });
    await user.click(await groupSwitch());
    const [a, b] = await main().findAllByRole('rowheader');
    expect(a?.querySelector('.ui-badge')).toHaveClass('expiry--warn');
    expect(b?.querySelector('.ui-badge')).toBeNull();
    expect(b).toHaveTextContent(t('ui.empty'));
  });

  it('switching it off forgets the choice', async () => {
    localStorage.setItem('apiseven.table.routes.group', 'host');
    const { user } = await open('#/routes', { objects });
    expect(await groupSwitch()).toBeChecked();
    await user.click(await groupSwitch());
    expect(await groupSwitch()).not.toBeChecked();
    expect(main().queryByRole('rowheader')).not.toBeInTheDocument();
    expect(localStorage.getItem('apiseven.table.routes.group')).toBeNull();
  });

  it('ignores a stored grouping the kind does not have, and kinds without groupings show no switch', async () => {
    localStorage.setItem('apiseven.table.routes.group', 'nope');
    const { user } = await open('#/routes', { objects });
    expect(await groupSwitch()).not.toBeChecked();
    await main().findByRole('link', { name: 'anywhere' });
    expect(main().queryByRole('rowheader')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    expect(await main().findByRole('heading', { level: 1, name: t('kind.upstreams.plural') })).toBeInTheDocument();
    expect(main().queryByRole('switch', { name: t('group.byHost') })).not.toBeInTheDocument();
  });
});

describe('a deleted object', () => {
  it('reopened (Back, a bookmark) shows "not found", not what was cached of it', async () => {
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'alpha' });
    await user.click(main().getByRole('link', { name: t('editor.back', { plural: t('kind.routes.plural') }) }));
    await rowAction(user, 'alpha', t('action.delete'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('delete.confirm', { kind: t('kind.routes.singular') }) }));
    await waitFor(() => expect(main().queryByRole('link', { name: 'alpha' })).not.toBeInTheDocument());
    act(() => {
      window.location.hash = '#/routes/r1';
    });
    expect(await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: t('kind.routes.singular'), id: 'r1' }) })).toBeInTheDocument();
  });
});
