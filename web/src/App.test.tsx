import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { t } from './i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from './test/app';
import { html502, json } from './test/fakeAdmin';

afterEach(resetApp);

const nav = async () => within(await screen.findByRole('navigation', { name: t('shell.nav') }));

describe('App', () => {
  it('renders the UI kit gallery at #/__kit, every component in every state', async () => {
    renderApp({ hash: '#/__kit' });
    expect(await screen.findByRole('heading', { name: /UI kit/ })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'limit-count config' })).toBeInTheDocument();
  });

  it('renders the schema form playground at #/__schema, from the plugin in the URL', async () => {
    renderApp({ hash: '#/__schema?plugin=limit-count' });
    expect(await screen.findByRole('heading', { name: /schema form/ })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'count (required)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Fallbacks: \d+ of \d+ top-level properties/ })).toBeInTheDocument();
  });

  it('shows a splash, not the Connect page, while config.json loads', async () => {
    let answer!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => (answer = resolve));
    vi.stubGlobal('fetch', vi.fn(() => pending));
    window.history.replaceState(null, '', '/#/connect');
    render(<App />);
    expect(screen.getByRole('status', { name: t('app.loading') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('connect.title') })).toBeNull();
    answer(new Response('Not Found', { status: 404 }));
    expect(await screen.findByRole('heading', { level: 1, name: t('connect.title') })).toBeInTheDocument();
  });

  it('opens the shell for a saved connection, with the sidebar counts', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    const { admin } = renderApp({ hash: '#/routes', key: DEV_CONN.key });
    const sidebar = await nav();
    await waitFor(() => expect(sidebar.getByRole('link', { name: `${t('kind.routes.plural')} 10` })).toBeInTheDocument());
    expect(admin.requests.filter((r) => r.url.pathname.includes('/apisix/admin/')).every((r) => r.key === DEV_CONN.key)).toBe(true);
    expect(await screen.findByText('APISIX 3.20.0')).toBeInTheDocument();
  });

  it('a file dropped where nothing takes it is refused, not left to the browser to open (Task 16b, item 128)', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes' });
    const link = (await nav()).getByRole('link', { name: new RegExp(`^${t('kind.routes.plural')}`) });
    const over = createEvent.dragOver(link, { dataTransfer: { types: ['Files'], dropEffect: 'copy' } });
    fireEvent(link, over);
    expect(over.defaultPrevented).toBe(true);
    const drop = createEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [] } });
    fireEvent(document.body, drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('server-managed (config.json)', () => {
  it('{adminBase, keyRequired: false} skips the Connect page and talks to the page origin without a key', async () => {
    const { admin } = renderApp({ config: { adminBase: '/apisix/admin', keyRequired: false } });
    const sidebar = await nav();
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    await waitFor(() => expect(sidebar.getByRole('link', { name: `${t('kind.routes.plural')} 10` })).toBeInTheDocument());
    const adminCalls = admin.requests.filter((r) => r.url.pathname.includes('/apisix/admin/'));
    expect(adminCalls.length).toBeGreaterThan(0);
    for (const r of adminCalls) {
      expect(r.url.origin).toBe(location.origin);
      expect(r.key).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: t('connect.title') })).toBeNull();
  });

  it('#/connect without a reason goes back to the routes', async () => {
    renderApp({ hash: '#/connect', config: { adminBase: '/apisix/admin', keyRequired: false } });
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
  });

  it("a rejected server-side key is a full-page error, not a form", async () => {
    renderApp({ hash: '#/routes', config: { adminBase: '/apisix/admin', keyRequired: false }, key: 'server-side-key' });
    expect(await screen.findByRole('heading', { level: 1, name: t('connect.serverKeyRejected.title') })).toBeInTheDocument();
    expect(screen.getByText(/APISIX_ADMIN_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(window.location.hash).toBe('#/connect');
  });
});

describe('errors', () => {
  it('a query failing with an auth error redirects to Connect, showing the reason', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/upstreams', key: 'the-real-key' });
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(t('connect.reason.auth'));
    expect(banner).toHaveTextContent('failed to check token: wrong apikey');
    // Connect offers to fix the key of the connection that failed.
    expect(screen.getByText(DEV_CONN.baseUrl)).toBeInTheDocument();
    expect(screen.getByLabelText(t('connect.key'), { exact: false })).toBeInTheDocument();
  });

  // Task 16b item 4: the redirect replaces the failing page, so Back does not lead into it again.
  it('the auth redirect to Connect replaces the failing page in the history', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/upstreams', key: 'the-real-key' });
    const before = window.history.length;
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    await screen.findByRole('alert');
    expect(window.history.length).toBe(before);
  });

  it('an HTML 502 on one list keeps the shell and marks that sidebar entry', async () => {
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes', replies: { upstreams: html502 } });
    const sidebar = await nav();
    const upstreams = sidebar.getByRole('link', { name: /^Upstreams/ });
    await waitFor(() => expect(upstreams.querySelector('.shell-nav__count--error')).not.toBeNull());
    await waitFor(() => expect(sidebar.getByRole('link', { name: `${t('kind.routes.plural')} 10` })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/routes');
    window.removeEventListener('unhandledrejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('a 500 from the Admin API is not a reason to leave', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes', replies: { routes: () => json(500, { error_msg: 'etcd down' }) } });
    const sidebar = await nav();
    await waitFor(() => expect(sidebar.getByRole('link', { name: /^Routes/ }).querySelector('.shell-nav__count--error')).not.toBeNull());
    expect(window.location.hash).toBe('#/routes');
  });
});
