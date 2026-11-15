import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { json } from '../test/fakeAdmin';

// What follows the page the user is on: the browser tab's title (known item 11) and the toasts (item 8).

afterEach(() => resetApp());

async function open(hash: string) {
  saveConnections([DEV_CONN], DEV_CONN.id);
  const app = renderApp({ hash, counts: {}, objects: { routes: [{ id: 'r1', name: 'web-home', uri: '/' }], consumers: [{ username: 'alice' }] } });
  await screen.findByRole('main');
  return { user: userEvent.setup(), ...app };
}

const main = () => within(screen.getByRole('main'));

describe('document.title', () => {
  it('a list is "<Kind> · apiseven"', async () => {
    await open('#/routes');
    await main().findByRole('link', { name: 'web-home' });
    expect(document.title).toBe(t('title.page', { page: t('kind.routes.plural') }));
    expect(document.title).toBe('Routes · apiseven');
  });

  it('an object is "<name> · <Kind> · apiseven", and follows the page the user moves to', async () => {
    const { user } = await open('#/routes/r1');
    await main().findByRole('heading', { level: 1, name: 'web-home' });
    expect(document.title).toBe('web-home · Route · apiseven');
    await user.click(screen.getByRole('link', { name: /^Consumers/ }));
    await main().findByRole('link', { name: 'alice' });
    await waitFor(() => expect(document.title).toBe('Consumers · apiseven'));
  });

  it('a new object, a missing one and an unknown page say so', async () => {
    const { unmount } = await open('#/routes/new');
    await main().findByRole('button', { name: t('editor.create') });
    expect(document.title).toBe('New Route · apiseven');
    unmount();
    const missing = await open('#/routes/gone');
    await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'gone' }) });
    expect(document.title).toBe('Not found · apiseven');
    missing.unmount();
    await open('#/nowhere/at/all');
    await main().findByRole('heading', { level: 1, name: t('notFound.title') });
    expect(document.title).toBe('Not found · apiseven');
  });
});

describe('document.title of a copy whose source failed to load (fix round 1, R4.6)', () => {
  it('is the create page\'s title, not the source\'s', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes/new?from=r9', counts: {}, objects: { routes: [] }, replies: { 'routes/r9': () => json(500, { error_msg: 'etcd down' }) } });
    await screen.findByRole('main');
    await main().findByText(/etcd down/, {}, { timeout: 4000 });
    expect(document.title).toBe('New Route · apiseven');
  });
});

describe('toasts and pages (known item 8)', () => {
  it('a refusal raised on one page is gone once the user moves to the next', async () => {
    const { user } = await open('#/routes/new');
    await user.click(await main().findByRole('button', { name: t('editor.create') }));
    const refusal = await screen.findByText(/^Fix \d+ problems? before saving/);
    expect(refusal).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /^Consumers/ }));
    await main().findByRole('link', { name: 'alice' });
    await waitFor(() => expect(screen.queryByText(/^Fix \d+ problems? before saving/)).not.toBeInTheDocument());
  });

  it('any other error lives out its time across pages: a refused write on a list, then the next page (fix round 1, R5)', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({
      hash: '#/routes',
      counts: {},
      objects: { routes: [{ id: 'r1', name: 'web-home', uri: '/' }], consumers: [{ username: 'alice' }] },
      replies: { 'routes/r1': (req) => (req.method === 'PATCH' ? json(500, { error_msg: 'etcd down' }) : undefined) },
    });
    const user = userEvent.setup();
    await screen.findByRole('main');
    await user.click(await main().findByRole('switch', { name: t('table.status.toggle', { name: 'web-home' }) }));
    expect(await screen.findByText('etcd down')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /^Consumers/ }));
    await main().findByRole('link', { name: 'alice' });
    expect(screen.getByText('etcd down')).toBeInTheDocument();
  });
});

describe('error states (known item 13)', () => {
  /** Every Admin API path answers, or gets no answer at all while `down.now` is true. */
  function outage() {
    const down = { now: false };
    const replies = new Proxy({}, { get: () => () => (down.now ? 'network' : undefined) });
    return { down, replies };
  }

  it('APISIX unreachable: a banner under the header names the address and the error, and Retry asks again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { down, replies } = outage();
      saveConnections([DEV_CONN], DEV_CONN.id);
      renderApp({ hash: '#/routes', counts: {}, objects: { routes: [{ id: 'r1', name: 'web-home', uri: '/' }] }, replies });
      await screen.findByRole('main');
      await main().findByRole('link', { name: 'web-home' });
      expect(screen.queryByText(t('unreachable.title'))).not.toBeInTheDocument();

      // APISIX goes away; the next read (the list's refresh) gets no answer, after React Query's two retries.
      down.now = true;
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(main().getByRole('button', { name: t('table.refresh') }));
      await vi.advanceTimersByTimeAsync(4000);
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(t('unreachable.title'));
      expect(within(banner).getByText(DEV_CONN.baseUrl)).toHaveClass('mono');
      expect(banner).toHaveTextContent(t('unreachable.body', { error: 'Network error: Failed to fetch' }));
      // What was loaded stays, said to be possibly out of date.
      expect(main().getByRole('link', { name: 'web-home' })).toBeInTheDocument();

      // Back again: Retry asks, and the banner goes.
      down.now = false;
      await user.click(within(banner).getByRole('button', { name: t('table.retry') }));
      await waitFor(() => expect(screen.queryByText(t('unreachable.title'))).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('a page that shows its own load error says where it could not reach, with one Try again; the banner stands down (fix round 1, R2.3)', async () => {
    const { down, replies } = outage();
    down.now = true;
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/routes/r1', counts: {}, objects: { routes: [{ id: 'r1', name: 'web-home', uri: '/' }] }, replies });
    await screen.findByRole('main');
    const state = await main().findByRole('alert', {}, { timeout: 6000 });
    expect(state).toHaveTextContent(`${t('unreachable.title')} ${DEV_CONN.baseUrl}`);
    expect(screen.getAllByRole('button', { name: t('table.retry') })).toHaveLength(1);
    expect(screen.queryByText(t('unreachable.body', { error: 'Network error: Failed to fetch' }))).not.toBeInTheDocument();
  });

  it('Try again in the banner leaves an editor\'s draft as it is (fix round 1, R2.4)', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    // One list gets no answer; the route itself loads.
    const sslsDown = { now: true };
    const { admin } = renderApp({
      hash: '#/routes/r1',
      counts: {},
      objects: { routes: [{ id: 'r1', name: 'web-home', uri: '/' }] },
      replies: { ssls: () => (sslsDown.now ? 'network' : undefined) },
    });
    const user = userEvent.setup();
    await screen.findByRole('main');
    await main().findByRole('heading', { level: 1, name: 'web-home' });
    await user.keyboard('e');
    const name = await main().findByRole('textbox', { name: t('rt.general.name') });
    await user.clear(name);
    await user.type(name, 'typed, not saved');
    const banner = await screen.findByRole('alert', {}, { timeout: 6000 });
    expect(banner).toHaveTextContent(t('unreachable.title'));
    // APISIX answers again; Try again refetches what the page shows, the route included.
    sslsDown.now = false;
    const asked = admin.requests.length;
    await user.click(within(banner).getByRole('button', { name: t('table.retry') }));
    await waitFor(() => expect(screen.queryByText(t('unreachable.title'))).not.toBeInTheDocument());
    await waitFor(() => expect(admin.requests.slice(asked).some((r) => r.url.pathname.endsWith('/routes/r1'))).toBe(true));
    expect(main().getByRole('textbox', { name: t('rt.general.name') })).toHaveValue('typed, not saved');
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
  });

  it('an address with no page, or an id that is not one path segment, is Not found with a way back to that kind\'s list', async () => {
    const { user } = await open('#/consumers/a%2Fb');
    await main().findByRole('heading', { level: 1, name: t('notFound.title') });
    const back = main().getByRole('link', { name: t('notFound.back', { plural: t('kind.consumers.plural') }) });
    await user.click(back);
    await main().findByRole('link', { name: 'alice' });
  });

  it('an object that does not exist is Not found, with a link back to its list', async () => {
    const { user } = await open('#/routes/gone');
    await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: 'Route', id: 'gone' }) });
    await user.click(main().getByRole('link', { name: t('editor.back', { plural: t('kind.routes.plural') }) }));
    await main().findByRole('link', { name: 'web-home' });
  });
});
