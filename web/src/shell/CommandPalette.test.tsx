import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { newPathFor, pathFor } from '../router/paths';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { GENERAL_TAB, overrideDef } from '../test/editor';
import { json, type FakeAdminOptions } from '../test/fakeAdmin';
import { THEME_STORAGE_KEY } from './theme';

beforeAll(async () => {
  await import('./CommandPalette');
});

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
  delete document.documentElement.dataset.theme;
});

const PROD = { id: 'prod', name: 'prod', baseUrl: 'https://prod.test:9180', key: 'prod-key' };

const ROUTES: Obj[] = [
  { id: 'r1', name: 'shop', hosts: ['shop.example.com'], uri: '/cart/*', plugins: { 'limit-count': {} } },
  { id: 'r2', name: 'blog', host: 'blog.example.com', uri: '/posts', status: 0 },
];

/** The app at `hash`, once the shell's main area is there. */
async function open(hash = '#/routes', opts: FakeAdminOptions & { connections?: (typeof DEV_CONN)[] } = {}) {
  const { connections = [DEV_CONN], ...rest } = opts;
  if (!rest.config) saveConnections(connections, DEV_CONN.id);
  const user = userEvent.setup();
  const app = renderApp({ hash, counts: {}, objects: { routes: ROUTES }, ...rest });
  await screen.findByRole('main');
  return { user, ...app };
}

const main = () => within(screen.getByRole('main'));

/** Opens the palette with Ctrl-K and waits for its search box. */
async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}');
  return within(await screen.findByRole('dialog', { name: t('palette.title') }));
}

const box = () => screen.getByRole('combobox', { name: t('palette.input') });

describe('finding objects', () => {
  it('typing a host finds its route; Enter opens it', async () => {
    const { user } = await open();
    const dialog = await openPalette(user);
    await user.type(box(), 'shop.example');
    const option = await dialog.findByRole('option', { name: /^shop/ });
    expect(option).toHaveTextContent(`${t('palette.field.host')} shop.example.com`);
    expect(within(option).getByText('shop.example', { selector: 'mark' })).toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: /^blog/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('routes', 'r1')}`));
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
  });

  it('typing a consumer username finds the consumer, under its kind', async () => {
    const { user } = await open('#/routes', { objects: { routes: ROUTES, consumers: [{ username: 'jo-partner', desc: 'Partner' }, { username: 'al' }] } });
    const dialog = await openPalette(user);
    await user.type(box(), 'jo-par');
    const group = await dialog.findByRole('group', { name: t('kind.consumers.plural') });
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(/^jo-partner/)]);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('consumers', 'jo-partner')}`));
  });

  it('a consumer is never found by its key-auth key', async () => {
    const { user } = await open('#/routes', { objects: { routes: ROUTES, consumers: [{ username: 'jo', plugins: { 'key-auth': { key: 'k-123' } } }] } });
    const dialog = await openPalette(user);
    await user.type(box(), 'k-123');
    expect(await dialog.findByText(t('palette.noResults', { query: 'k-123' }), { selector: 'p' })).toBeInTheDocument();
    expect(dialog.queryAllByRole('option')).toEqual([]);
  });

  it('a disabled route and an expired certificate show their state', async () => {
    const { user } = await open('#/routes', { objects: { routes: ROUTES, ssls: [{ id: 's1', snis: ['old.example.com'], validity_end: 1_000_000_000 }] } });
    const dialog = await openPalette(user);
    await user.type(box(), 'example');
    expect(within(await dialog.findByRole('option', { name: /^blog/ })).getByText(t('table.status.disabled'))).toBeInTheDocument();
    expect(within(dialog.getByRole('option', { name: /^shop/ })).queryByText(t('table.status.disabled'))).not.toBeInTheDocument();
    expect(within(dialog.getByRole('option', { name: /^old\.example\.com/ })).getByText(/^expired /)).toBeInTheDocument();
  });

  it('shows at most 6 per kind; "Show all N here" shows every hit in place, without leaving the page', async () => {
    // Found by a label the list page's own search would not find as typed (it reads `"env":"prod"`).
    const many: Obj[] = [...Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: `api-${i}`, uri: `/a${i}`, labels: { env: 'prod' } })), { id: 'x', name: 'other', uri: '/x' }];
    const { user } = await open('#/upstreams', { objects: { routes: many, upstreams: [{ id: 'u1', name: 'prod-pool', nodes: [] }] } });
    const dialog = await openPalette(user);
    await user.type(box(), 'env:prod');
    const group = await dialog.findByRole('group', { name: t('kind.routes.plural') });
    const options = within(group).getAllByRole('option');
    expect(options).toHaveLength(7);
    const more = options.at(-1) as HTMLElement;
    expect(more).toHaveTextContent(t('palette.showAllHere', { count: 8 }));
    // By keyboard: the "Show all" row is the 7th choice.
    for (let i = 0; i < 6; i++) await user.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', more.id);
    // Enter on it shows the rest: the hints say so, not "open".
    const hints = document.querySelector('.cp-hints');
    expect(hints).toHaveTextContent(t('palette.hint.expand'));
    expect(hints).not.toHaveTextContent(t('palette.hint.open'));
    const moreId = more.id;
    await user.keyboard('{Enter}');
    const all = within(dialog.getByRole('group', { name: t('kind.routes.plural') })).getAllByRole('option');
    expect(all.map((o) => /^api-\d/.exec(o.textContent ?? '')?.[0])).toEqual(Array.from({ length: 8 }, (_, i) => `api-${i}`));
    expect(window.location.hash).toBe('#/upstreams');
    // The first row that was hidden takes the place of "Show all", under an id of its own (so the
    // change is announced), and the keys go on from there.
    expect(box()).toHaveAttribute('aria-activedescendant', all[6]?.id);
    expect(all[6]?.id).not.toBe(moreId);
    expect(all[6]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', all[7]?.id);
    expect(dialog.getByRole('status')).toHaveTextContent(t('palette.count.other', { count: 8 }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('routes', 'a7')}`));
  });

  it('a click on "Show all N here" expands the group too', async () => {
    const many: Obj[] = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, name: `api-${i}`, uri: `/a${i}` }));
    const { user } = await open('#/upstreams', { objects: { routes: many } });
    const dialog = await openPalette(user);
    await user.type(box(), 'api-');
    await user.click(await dialog.findByRole('option', { name: t('palette.showAllHere', { count: 7 }) }));
    expect(within(dialog.getByRole('group', { name: t('kind.routes.plural') })).getAllByRole('option')).toHaveLength(7);
    expect(dialog.queryByRole('option', { name: t('palette.showAllHere', { count: 7 }) })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/upstreams');
  });

  it('a list still loading shows one muted row; a failed one says so; the others are still searched', async () => {
    const { user } = await open('#/routes', {
      objects: { routes: ROUTES, protos: [] },
      replies: {
        // The palette fetches protos, secrets and plugin metadata itself; the support check (page_size 10) answers.
        protos: (req) => (req.url.searchParams.get('page_size') === '500' ? new Promise<undefined>(() => {}) : undefined),
        secrets: (req) => (req.url.searchParams.get('page_size') === '500' ? json(500, { error_msg: 'etcd down' }) : undefined),
      },
    });
    const dialog = await openPalette(user);
    await user.type(box(), 'shop');
    expect(await dialog.findByRole('option', { name: /^shop/ })).toBeInTheDocument();
    // A count is not stated as complete while a list is missing.
    expect(dialog.getByRole('status')).toHaveTextContent(t('palette.count.oneSoFar'));
    const loading = await dialog.findByRole('option', { name: t('palette.loading', { plural: t('kind.protos.plural') }) });
    expect(loading).toHaveAttribute('aria-disabled', 'true');
    const failed = await dialog.findByRole('option', { name: t('palette.failed', { plural: t('kind.secrets.plural') }) });
    expect(failed).toHaveAttribute('aria-disabled', 'true');
    // Nothing found is not stated as a fact while a list is missing.
    await user.clear(box());
    await user.type(box(), 'nothing-here');
    expect(await dialog.findByText(t('palette.noResultsPartial', { query: 'nothing-here' }), { selector: 'p' })).toBeInTheDocument();
    // …nor announced as one.
    expect(dialog.getByRole('status')).toHaveTextContent(t('palette.noResultsPartial', { query: 'nothing-here' }));
    expect(dialog.getByRole('status')).not.toHaveTextContent(t('palette.count.none'));
  });

  it('kinds this APISIX lacks are not searched or offered', async () => {
    const { user } = await open('#/routes', {
      objects: { routes: ROUTES },
      replies: { stream_routes: () => json(400, { error_msg: 'stream mode is disabled' }) },
    });
    const dialog = await openPalette(user);
    await waitFor(() => expect(dialog.queryByRole('option', { name: t('palette.action.goTo', { plural: t('kind.stream_routes.plural') }) })).not.toBeInTheDocument());
    await user.type(box(), 'stream');
    expect(dialog.queryByText(t('palette.loading', { plural: t('kind.stream_routes.plural') }))).not.toBeInTheDocument();
    expect(dialog.queryByText(t('palette.failed', { plural: t('kind.stream_routes.plural') }))).not.toBeInTheDocument();
  });
});

describe('actions', () => {
  it('with an empty query lists Go to, New, connection and theme actions', async () => {
    const { user } = await open('#/routes', { connections: [DEV_CONN, PROD] });
    const dialog = await openPalette(user);
    for (const name of [
      t('palette.action.goTo', { plural: t('kind.routes.plural') }),
      t('palette.action.goTo', { plural: t('kind.protos.plural') }),
      t('page.new', { kind: t('kind.routes.singular') }),
      t('palette.action.switch', { name: 'prod (prod.test:9180)' }),
      t('palette.action.manage'),
      t('palette.action.theme', { theme: t('theme.dark') }),
    ]) {
      expect(await dialog.findByRole('option', { name })).toBeInTheDocument();
    }
    // The active connection is not offered.
    expect(dialog.queryByRole('option', { name: /^Switch to dev/ })).not.toBeInTheDocument();
  });

  it('"new ro" finds New Route, which opens the create page', async () => {
    const { user } = await open();
    const dialog = await openPalette(user);
    await user.type(box(), 'new ro');
    const options = await dialog.findAllByRole('option');
    expect(options[0]).toHaveAccessibleName(t('page.new', { kind: t('kind.routes.singular') }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${newPathFor('routes')}`));
  });

  it('no New action while the key is read-only', async () => {
    const { user } = await open('#/routes', {
      replies: { 'routes/r1': (req) => (req.method === 'PATCH' ? json(401, { error_msg: 'invalid method for role viewer' }) : undefined) },
    });
    await user.click(await main().findByRole('switch', { name: t('table.status.toggle', { name: 'shop' }) }));
    expect(await screen.findByText(t('readOnly.banner'))).toBeInTheDocument();
    const dialog = await openPalette(user);
    expect(await dialog.findByRole('option', { name: t('palette.action.goTo', { plural: t('kind.routes.plural') }) })).toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: /^New / })).not.toBeInTheDocument();
    await user.type(box(), 'new');
    expect(dialog.queryByRole('option', { name: /^New / })).not.toBeInTheDocument();
  });

  it('"Switch to prod" makes prod the active connection, on the same kind of list', async () => {
    const { user, admin } = await open('#/routes/r1', { connections: [DEV_CONN, PROD] });
    const dialog = await openPalette(user);
    await user.type(box(), 'prod');
    await user.click(await dialog.findByRole('option', { name: t('palette.action.switch', { name: 'prod (prod.test:9180)' }) }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Connection: prod/ })).toBeInTheDocument());
    await waitFor(() => expect(admin.requests.some((r) => r.url.origin === 'https://prod.test:9180')).toBe(true));
    expect(window.location.hash).toBe('#/routes');
  });

  it('"Manage connections" opens Connect', async () => {
    const { user } = await open('#/routes', { connections: [DEV_CONN, PROD] });
    const dialog = await openPalette(user);
    await user.type(box(), 'manage');
    await user.click(await dialog.findByRole('option', { name: t('palette.action.manage') }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
  });

  it('the theme action sets the theme', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const { user } = await open();
    const dialog = await openPalette(user);
    await user.type(box(), 'dark');
    await user.click(await dialog.findByRole('option', { name: t('palette.action.theme', { theme: t('theme.dark') }) }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
  });

  it('server-managed mode offers no connection actions', async () => {
    const { user } = await open('#/routes', { config: { adminBase: '/apisix/admin', keyRequired: false } });
    const dialog = await openPalette(user);
    expect(await dialog.findByRole('option', { name: t('palette.action.goTo', { plural: t('kind.routes.plural') }) })).toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: /^Switch to / })).not.toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: t('palette.action.manage') })).not.toBeInTheDocument();
    await user.type(box(), 'connection');
    expect(dialog.queryByRole('option', { name: t('palette.action.manage') })).not.toBeInTheDocument();
  });

  it('no action writes to APISIX', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const { user, admin } = await open('#/routes', { connections: [DEV_CONN, PROD] });
    for (const query of ['new route', 'theme light', 'go to upstreams']) {
      const dialog = await openPalette(user);
      await user.type(box(), query);
      await dialog.findAllByRole('option');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument());
    }
    expect(admin.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });
});

describe('leaving an editor', () => {
  it('choosing a result from an editor with unsaved changes asks; Stay keeps the draft and the palette closed', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'more');
    const dialog = await openPalette(user);
    await user.type(box(), 'blog');
    await dialog.findByRole('option', { name: /^blog/ });
    await user.keyboard('{Enter}');
    const leave = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
    await user.click(within(leave).getByRole('button', { name: t('ui.cancel') }));
    expect(window.location.hash).toBe('#/routes/r1');
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/cart/*more');
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
    // Focus goes back where it was before the palette opened (Task 16b, item 136).
    await waitFor(() => expect(main().getByRole('textbox', { name: 'URI' })).toHaveFocus());
  });

  it('after Stay, focus goes to the main area when what had it before the palette is gone (Task 16b, item 136)', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'more');
    // An element outside React that had focus, gone by the time the user answers.
    const gone = document.createElement('button');
    document.body.append(gone);
    gone.focus();
    const dialog = await openPalette(user);
    await user.type(box(), 'blog');
    await dialog.findByRole('option', { name: /^blog/ });
    await user.keyboard('{Enter}');
    const leave = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    gone.remove();
    await user.click(within(leave).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    expect(window.location.hash).toBe('#/routes/r1');
  });

  it('Leave goes to the result', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'more');
    const dialog = await openPalette(user);
    await user.type(box(), 'blog');
    await dialog.findByRole('option', { name: /^blog/ });
    await user.keyboard('{Enter}');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('routes', 'r2')}`));
  });

  it('"Switch to" from an editor with unsaved changes asks too; Stay keeps the connection', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user } = await open('#/routes/r1', { connections: [DEV_CONN, PROD] });
    await main().findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: 'URI' }), 'more');
    const dialog = await openPalette(user);
    await user.type(box(), 'prod');
    await user.click(await dialog.findByRole('option', { name: t('palette.action.switch', { name: 'prod (prod.test:9180)' }) }));
    const leave = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    await user.click(within(leave).getByRole('button', { name: t('ui.cancel') }));
    expect(screen.getByRole('button', { name: /^Connection: dev/ })).toBeInTheDocument();
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/cart/*more');
  });
});
