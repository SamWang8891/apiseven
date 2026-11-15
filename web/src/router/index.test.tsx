import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { json } from '../test/fakeAdmin';
import { kindFromSegment, newPathFor, pathFor } from './paths';

afterEach(resetApp);

async function mainRegion() {
  return within(await screen.findByRole('main'));
}

describe('editor routes', () => {
  const cases: { kind: Kind; id: string; parent?: Parent; adminPath: string }[] = [
    // An id with a slash is Not found since fix round 2 (R4, under "unknown paths").
    { kind: 'routes', id: 'a b?c#d%', adminPath: 'routes/a%20b%3Fc%23d%25' },
    { kind: 'secrets', id: 'vault/my id', adminPath: 'secrets/vault/my%20id' },
    { kind: 'credentials', id: 'c 1', parent: { consumer: 'jo e' }, adminPath: 'consumers/jo%20e/credentials/c%201' },
  ];

  for (const { kind, id, parent, adminPath } of cases) {
    it(`round-trips ${kind} id ${JSON.stringify(id)}${parent ? ` under consumer ${JSON.stringify(parent.consumer)}` : ''}`, async () => {
      saveConnections([DEV_CONN], DEV_CONN.id);
      const etcdKey = parent ? `/apisix/consumers/${parent.consumer}/credentials/${id}` : `/apisix/${kind}/${id}`;
      const { admin } = renderApp({
        hash: `#${pathFor(kind, id, parent)}`,
        replies: { [adminPath]: () => json(200, { key: etcdKey, value: { id }, modifiedIndex: 1 }) },
      });
      const main = await mainRegion();
      // The editor asked APISIX for exactly this object, and shows its decoded id.
      expect(await main.findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
      expect(admin.requests.some((r) => r.method === 'GET' && r.url.pathname.endsWith(`/apisix/admin/${adminPath}`))).toBe(true);
      expect(main.getByText(id, { selector: '.mono' })).toBeInTheDocument();
      expect(window.location.hash).toBe(`#${pathFor(kind, id, parent)}`);
    });
  }

  it('opens the create page at newPathFor', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: `#${newPathFor('credentials', { consumer: 'jo e' })}` });
    const main = await mainRegion();
    expect(main.getByRole('heading', { level: 1, name: t('page.new', { kind: t('kind.credentials.singular') }) })).toBeInTheDocument();
    // Back leads to the owning consumer's Credentials tab (Task 13).
    expect(main.getByRole('link', { name: t('editor.backTo', { kind: t('kind.consumers.singular'), name: 'jo e' }) })).toHaveAttribute(
      'href',
      `#${pathFor('consumers', 'jo e')}?tab=credentials`,
    );
  });

  it('mounts the list page at #/<kind>', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/upstreams', counts: { upstreams: 2 } });
    const main = await mainRegion();
    expect(main.getByRole('heading', { level: 1, name: t('kind.upstreams.plural') })).toBeInTheDocument();
    expect(await main.findByRole('link', { name: 'upstreams-2' })).toHaveAttribute('href', `#${pathFor('upstreams', 'upstreams-2')}`);
    expect(main.getByRole('table')).toBeInTheDocument();
  });
});

describe('unknown paths', () => {
  it('kindFromSegment("nope") is undefined, and #/nope renders Not found inside the shell', async () => {
    expect(kindFromSegment('nope')).toBeUndefined();
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/nope' });
    const main = await mainRegion();
    expect(main.getByRole('heading', { level: 1, name: t('notFound.title') })).toBeInTheDocument();
    // The shell is still there.
    expect(screen.getByRole('navigation', { name: t('shell.nav') })).toBeInTheDocument();
  });

  // An id or a consumer that would not stay one path segment once decoded (fix round 2, R4): Not found,
  // and no request ever names such a path.
  for (const hash of ['#/routes/r1%2Fx', '#/routes/..', '#/consumers/a%2Fb/credentials/new', '#/consumers/..%2Froutes/credentials/new', '#/consumers/a%2Fcredentials%2Fk0/credentials/new', '#/consumers/jo/credentials/..']) {
    it(`${hash} is Not found, and nothing is requested for it`, async () => {
      saveConnections([DEV_CONN], DEV_CONN.id);
      const { admin } = renderApp({ hash, objects: { routes: [{ id: 'r1', uri: '/' }], consumers: [{ username: 'jo' }] } });
      const main = await mainRegion();
      expect(await main.findByRole('heading', { level: 1, name: t('notFound.title') })).toBeInTheDocument();
      await new Promise((done) => setTimeout(done, 30));
      const paths = admin.requests.map((r) => decodeURIComponent(r.url.pathname));
      expect(paths.filter((p) => /\/(?:r1\/x|\.\.|a\/b|a\/credentials)/.test(p))).toEqual([]);
    });
  }

  for (const hash of ['#/credentials', '#/nope/x', '#/routes/a/b', '#/consumers/jo/credentials']) {
    it(`${hash} is Not found`, async () => {
      saveConnections([DEV_CONN], DEV_CONN.id);
      renderApp({ hash });
      const main = await mainRegion();
      expect(main.getByRole('heading', { level: 1, name: t('notFound.title') })).toBeInTheDocument();
    });
  }
});

describe('#/', () => {
  it('goes to the routes list when there is a connection', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/' });
    await waitFor(() => expect(window.location.hash).toBe('#/routes'));
    expect(await screen.findByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeInTheDocument();
  });

  it('goes to Connect when there is none', async () => {
    renderApp({ hash: '#/' });
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    expect(await screen.findByRole('heading', { level: 1, name: t('connect.title') })).toBeInTheDocument();
  });

  it('sends a deep link to Connect when there is no connection', async () => {
    renderApp({ hash: '#/routes/r1' });
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
  });
});
