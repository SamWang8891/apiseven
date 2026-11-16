import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { html502, json } from '../test/fakeAdmin';
import { STORAGE_KEYS } from './store';

afterEach(resetApp);

const KEY = 'edd1c9f034335f136f87ad84b625c8f1';

async function openConnect(opts: Parameters<typeof renderApp>[0] = {}) {
  const user = userEvent.setup();
  const view = renderApp({ hash: '#/connect', ...opts });
  await screen.findByRole('heading', { level: 1, name: t('connect.title') });
  return { user, ...view };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, url: string, key: string) {
  await user.type(screen.getByLabelText(t('connect.url')), url);
  if (key) await user.type(screen.getByLabelText(t('connect.key'), { exact: false }), key);
  await user.click(screen.getByRole('button', { name: t('connect.submit') }));
}

/** Requests to the Admin API (config.json excluded). */
function adminRequests<T extends { url: URL }>(requests: T[]): T[] {
  return requests.filter((r) => r.url.pathname.includes('/apisix/admin/'));
}

/** The logo sits before the app name, at 44 px, as decoration: the name beside it is the text. */
function expectLogoBesideName() {
  const name = screen.getByText(t('app.name'));
  const logo = name.querySelector(':scope > img');
  expect(logo).toHaveAttribute('alt', '');
  expect(logo).toHaveAttribute('src', expect.stringMatching(/logo.*\.png$/));
  expect(logo).toHaveAttribute('width', '44');
  expect(logo).toHaveAttribute('height', '44');
  expect(logo?.nextSibling?.textContent).toBe(t('app.name'));
  expect(within(name).queryByRole('img')).toBeNull();
}

describe('Connect page', () => {
  it('shows the logo beside the app name', async () => {
    await openConnect();
    expectLogoBesideName();
  });

  it('shows it too when the server-side key was rejected', async () => {
    renderApp({ hash: '#/routes', config: { adminBase: '/apisix/admin', keyRequired: false }, key: 'server-side-key' });
    await screen.findByRole('heading', { level: 1, name: t('connect.serverKeyRejected.title') });
    expectLogoBesideName();
  });

  it('is where an empty browser starts', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: t('connect.title') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/connect');
  });

  it('pings with the URL and key, saves the connection and opens the routes list', async () => {
    const { user, admin } = await openConnect({ key: KEY });
    await fillAndSubmit(user, '  http://127.0.0.1:9180/apisix/admin/  ', KEY);
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));

    const ping = adminRequests(admin.requests)[0]!;
    expect(ping.url.href).toBe('http://127.0.0.1:9180/apisix/admin/routes?page=1&page_size=10');
    expect(ping.key).toBe(KEY);

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.connections)!) as { name: string; baseUrl: string }[];
    expect(saved).toMatchObject([{ name: '127.0.0.1:9180', baseUrl: 'http://127.0.0.1:9180', key: KEY }]);
    expect(await screen.findByRole('navigation', { name: t('shell.nav') })).toBeInTheDocument();
  });

  it('uses the name given', async () => {
    const { user } = await openConnect({ key: KEY });
    await user.type(screen.getByLabelText(t('connect.name')), 'staging');
    await fillAndSubmit(user, 'https://apisix.example.com', KEY);
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    expect(localStorage.getItem(STORAGE_KEYS.connections)).toContain('"name":"staging"');
  });

  it('shows the bad-key message on an auth error, and stays', async () => {
    const { user } = await openConnect({ key: KEY });
    await fillAndSubmit(user, 'http://127.0.0.1:9180', 'wrong-key');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('connect.badKey'));
    expect(alert).toHaveTextContent('failed to check token: wrong apikey');
    expect(window.location.hash).toBe('#/connect');
    expect(localStorage.getItem(STORAGE_KEYS.connections)).toBeNull();
  });

  it('names allow_admin and enable_admin_cors when the request fails outright', async () => {
    const { user } = await openConnect({ replies: { routes: () => 'network' } });
    await fillAndSubmit(user, 'http://10.1.2.3:9180', KEY);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('allow_admin');
    expect(alert.textContent).toContain('enable_admin_cors');
  });

  it('says when the answer is not from an APISIX Admin API, with the status', async () => {
    const { user } = await openConnect({ replies: { routes: html502 } });
    await fillAndSubmit(user, 'http://10.1.2.3:9180', KEY);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('connect.notAdmin', { status: 'HTTP 502' }));
  });

  it('says the same for a JSON error that is not about the key', async () => {
    const { user } = await openConnect({ replies: { routes: () => json(404, { error_msg: 'not found' }) } });
    await fillAndSubmit(user, 'http://10.1.2.3:9180', KEY);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('connect.notAdmin', { status: 'HTTP 404' }));
  });

  for (const url of ['ftp://10.1.2.3:21', 'localhost:9180', 'not a url', 'javascript:alert(1)']) {
    it(`rejects ${JSON.stringify(url)} inline without calling the API`, async () => {
      const { user, admin } = await openConnect();
      await fillAndSubmit(user, url, KEY);
      expect(await screen.findByText(t('connect.urlInvalid'))).toBeInTheDocument();
      expect(screen.getByLabelText(t('connect.url'))).toHaveAttribute('aria-invalid', 'true');
      expect(adminRequests(admin.requests)).toEqual([]);
    });
  }

  it('asks for a URL before calling the API', async () => {
    const { user, admin } = await openConnect();
    await user.click(screen.getByRole('button', { name: t('connect.submit') }));
    expect(await screen.findByText(t('connect.urlRequired'))).toBeInTheDocument();
    expect(adminRequests(admin.requests)).toEqual([]);
  });

  it('shows the request it will make, from the normalised URL', async () => {
    const { user } = await openConnect();
    await user.type(screen.getByLabelText(t('connect.url')), 'http://h:9180/apisix/admin//');
    expect(screen.getByLabelText(t('connect.url'))).toHaveAccessibleDescription(
      `${t('connect.urlHelp')} ${t('connect.request', { url: 'http://h:9180/apisix/admin/routes' })}`,
    );
  });

  it('with "remember" unticked, writes nothing containing the key to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { user } = await openConnect({ key: KEY });
    await user.click(screen.getByRole('checkbox', { name: t('connect.remember') }));
    await fillAndSubmit(user, 'http://127.0.0.1:9180', KEY);
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    const localWrites = setItem.mock.calls.filter((_, i) => setItem.mock.contexts[i] === localStorage);
    expect(localWrites.length).toBeGreaterThan(0);
    for (const [name, value] of localWrites) {
      expect(name).not.toContain(KEY);
      expect(value).not.toContain(KEY);
    }
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionKeys)).toContain(KEY);
  });
});

// Final wave G1: what is kept is decided when the check answers, and a check is about the fields as submitted.
describe('a check still pending', () => {
  /** A fake Admin API whose answer to the check waits for `release`. */
  function gated() {
    let release = () => {};
    const gate = new Promise<undefined>((done) => (release = () => done(undefined)));
    return { replies: { routes: () => gate }, release: () => release() };
  }

  it('Remember unticked while the check runs: the key is kept for this tab only, never in localStorage', async () => {
    const { replies, release } = gated();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { user } = await openConnect({ key: KEY, replies });
    const remember = screen.getByRole('checkbox', { name: t('connect.remember') });
    expect(remember).toBeChecked();
    await fillAndSubmit(user, 'http://127.0.0.1:9180', KEY);
    await user.click(remember);
    expect(remember).not.toBeChecked();
    release();
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    const localWrites = setItem.mock.calls.filter((_, i) => setItem.mock.contexts[i] === localStorage);
    for (const [name, value] of localWrites) {
      expect(name).not.toContain(KEY);
      expect(value).not.toContain(KEY);
    }
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionKeys)).toContain(KEY);
  });

  // Fix round 1, R1.4: no fixed wait. The test waits until the stale answer has been handed back, then
  // checks again with the fields as they are now: only that check decides what is saved.
  it('a connection field changed while the check runs: its answer is ignored, nothing is saved, the page stays', async () => {
    let release = () => {};
    const gate = new Promise<undefined>((done) => (release = () => done(undefined)));
    /** How many checks were answered: an answer is counted as it is handed back. */
    let answered = 0;
    const replies = { routes: () => gate.then(() => void answered++) };
    const { user } = await openConnect({ key: KEY, replies });
    await fillAndSubmit(user, 'http://127.0.0.1:9180', KEY);
    await user.type(screen.getByLabelText(t('connect.name')), 'renamed');
    release();
    await waitFor(() => expect(answered).toBe(1));
    // Let the stale answer run through the client and the dropped check.
    await act(async () => {
      await gate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.location.hash).toBe('#/connect');
    expect(localStorage.getItem(STORAGE_KEYS.connections) ?? '').not.toContain('127.0.0.1');
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionKeys) ?? '').not.toContain(KEY);
    expect(screen.getByLabelText(t('connect.name'))).toHaveValue('renamed');
    // The fields as they are now: a new check is what connects, and only its connection is kept.
    await user.click(screen.getByRole('button', { name: t('connect.submit') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    const saved = (JSON.parse(localStorage.getItem(STORAGE_KEYS.connections) ?? '[]') as { name: string }[]).map((c) => c.name);
    expect(saved).toEqual(['renamed']);
  });
});

describe('saved connections', () => {
  const other = { id: 'other', name: 'prod', baseUrl: 'http://prod.test:9180', key: 'prod-key' };

  it('lists them; Connect switches, Remove asks first', async () => {
    saveConnections([DEV_CONN, other], DEV_CONN.id);
    const { user, admin } = await openConnect();
    const list = screen.getByRole('list', { name: t('connect.saved') });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/^(dev|prod)$/).textContent)).toEqual(['dev', 'prod']);

    await user.click(within(items[1]!).getByRole('button', { name: t('connect.removeNamed', { name: 'prod' }) }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: t('connect.remove') }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(localStorage.getItem(STORAGE_KEYS.connections)).not.toContain('prod-key');
    // Fix round 1, R1: its Remove button is gone; focus lands on the page's heading, never on body.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: t('connect.title') })).toHaveFocus());

    await user.click(within(list).getByRole('button', { name: t('connect.useNamed', { name: 'dev' }) }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    await waitFor(() => expect(adminRequests(admin.requests).length).toBeGreaterThan(0));
    expect(adminRequests(admin.requests).every((r) => r.url.origin === 'http://apisix.test:9180')).toBe(true);
  });

  it('a connection whose key stayed in another tab asks only for the key', async () => {
    saveConnections([{ id: 'tab', name: 'staging', baseUrl: 'http://staging.test:9180', sessionOnly: true }], 'tab');
    const user = userEvent.setup();
    renderApp({ hash: '#/routes', key: KEY });
    await screen.findByRole('heading', { level: 1, name: t('connect.title') });
    expect(window.location.hash).toBe('#/connect');
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('http://staging.test:9180')).toBeInTheDocument();
    expect(screen.queryByLabelText(t('connect.url'))).toBeNull();
    expect(screen.queryByLabelText(t('connect.name'))).toBeNull();

    // It was saved for one tab only; asking again keeps that choice.
    expect(screen.getByRole('checkbox', { name: t('connect.remember') })).not.toBeChecked();

    await user.type(screen.getByLabelText(t('connect.key'), { exact: false }), KEY);
    await user.click(screen.getByRole('button', { name: t('connect.submit') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.connections)!) as { name: string }[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'staging', baseUrl: 'http://staging.test:9180', sessionOnly: true });
    expect(localStorage.getItem(STORAGE_KEYS.connections)).not.toContain(KEY);
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionKeys)).toContain(KEY);
  });
});

describe('server-managed Connect', () => {
  it('with keyRequired, asks only for the key and talks to the page origin', async () => {
    const { user, admin } = await openConnect({ config: { adminBase: '/apisix/admin', keyRequired: true }, key: KEY });
    expect(screen.queryByLabelText(t('connect.url'))).toBeNull();
    expect(screen.queryByLabelText(t('connect.name'))).toBeNull();
    expect(screen.queryByRole('list', { name: t('connect.saved') })).toBeNull();

    await user.type(screen.getByLabelText(t('connect.key'), { exact: false }), KEY);
    await user.click(screen.getByRole('button', { name: t('connect.submit') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    const ping = adminRequests(admin.requests)[0]!;
    expect(ping.url.origin).toBe(location.origin);
    expect(ping.key).toBe(KEY);
  });
});
