import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { json, type FakeAdminOptions } from '../test/fakeAdmin';

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

  it('with zero items shows the empty state and a Create link to #/<kind>/new', async () => {
    await open('#/protos');
    const empty = await main().findByRole('region', { name: t('table.empty.title', { plural: t('kind.protos.plural') }) });
    expect(within(empty).getByRole('link', { name: t('page.new', { kind: t('kind.protos.singular') }) })).toHaveAttribute(
      'href',
      '#/protos/new',
    );
  });

  it('Edit opens the editor and Duplicate the create page with ?from=<encoded id>', async () => {
    const { user } = await open('#/routes', { objects: { routes: [{ id: 'a/b', name: 'slashy' }] } });
    await rowAction(user, 'slashy', t('action.duplicate'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/new?from=a%2Fb'));
    window.history.back();
    await rowAction(user, 'slashy', t('action.edit'));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/a%2Fb'));
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
    await waitFor(async () => expect(await toggle('alpha')).toBeChecked());
    expect(window.location.hash).toBe('#/routes');
    // The banner stays on other pages of the same connection.
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    expect(await main().findByRole('heading', { level: 1, name: t('kind.upstreams.plural') })).toBeInTheDocument();
    expect(screen.getByText(t('readOnly.banner'))).toBeInTheDocument();
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
