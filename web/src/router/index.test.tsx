import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { kindFromSegment, newPathFor, pathFor } from './paths';

afterEach(resetApp);

async function mainRegion() {
  return within(await screen.findByRole('main'));
}

describe('editor routes', () => {
  const cases: { kind: Kind; id: string; parent?: Parent }[] = [
    { kind: 'routes', id: 'a/b' },
    { kind: 'routes', id: 'a b?c#d%' },
    { kind: 'secrets', id: 'vault/my id' },
    { kind: 'credentials', id: 'c 1', parent: { consumer: 'jo e' } },
  ];

  for (const { kind, id, parent } of cases) {
    it(`round-trips ${kind} id ${JSON.stringify(id)}${parent ? ` under consumer ${JSON.stringify(parent.consumer)}` : ''}`, async () => {
      saveConnections([DEV_CONN], DEV_CONN.id);
      renderApp({ hash: `#${pathFor(kind, id, parent)}` });
      const main = await mainRegion();
      expect(main.getByRole('heading', { level: 1, name: t(`kind.${kind}.singular`) })).toBeInTheDocument();
      // Exactly the decoded id: getByText matches the whole text of an element.
      expect(main.getByText(id)).toHaveClass('mono');
      if (parent) expect(main.getByText(parent.consumer)).toHaveClass('mono');
      expect(window.location.hash).toBe(`#${pathFor(kind, id, parent)}`);
    });
  }

  it('opens the create page at newPathFor', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: `#${newPathFor('credentials', { consumer: 'jo e' })}` });
    const main = await mainRegion();
    expect(main.getByRole('heading', { level: 1, name: t('page.new', { kind: t('kind.credentials.singular') }) })).toBeInTheDocument();
    expect(main.getByText('jo e')).toHaveClass('mono');
  });

  it('shows the item count on the list placeholder', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    renderApp({ hash: '#/upstreams', counts: { upstreams: 2 } });
    const main = await mainRegion();
    expect(main.getByRole('heading', { level: 1, name: t('kind.upstreams.plural') })).toBeInTheDocument();
    expect(await main.findByText(t('page.count', { count: 2 }))).toBeInTheDocument();
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
