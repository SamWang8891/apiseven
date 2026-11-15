import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { ClientProvider } from '../api/hooks';
import { t } from '../i18n';
import { fakeAdmin, html502, json, type FakeAdminOptions } from '../test/fakeAdmin';
import { TooltipProvider } from '../ui';
import { Sidebar } from './Sidebar';

const clients: QueryClient[] = [];
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

function renderSidebar(opts: FakeAdminOptions, path = '/routes') {
  const { fetch } = fakeAdmin(opts);
  const client = new AdminClient({ id: 'c', name: 'c', baseUrl: 'http://apisix.test:9180' }, fetch);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const router = createMemoryRouter([{ path: '*', element: <Sidebar /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={qc}>
      <ClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ClientProvider>
    </QueryClientProvider>,
  );
}

const nav = () => within(screen.getByRole('navigation', { name: t('shell.nav') }));

describe('Sidebar', () => {
  it('lists the kinds in their groups and order, with counts from the list lengths', async () => {
    renderSidebar({ counts: { routes: 10, stream_routes: 1, upstreams: 2, consumers: 3, protos: 1 } });
    await waitFor(() => expect(nav().getByRole('link', { name: `${t('kind.routes.plural')} 10` })).toBeInTheDocument());
    await waitFor(() => expect(nav().getByRole('link', { name: `${t('kind.protos.plural')} 1` })).toBeInTheDocument());
    expect(nav().getByRole('link', { name: `${t('kind.consumers.plural')} 3` })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: `${t('kind.services.plural')} 0` })).toBeInTheDocument();

    const groups = nav().getAllByRole('list');
    const names = [t('nav.traffic'), t('nav.access'), t('nav.plugins'), t('nav.other')];
    expect(groups).toHaveLength(names.length);
    groups.forEach((g, i) => expect(g).toHaveAccessibleName(names[i]));
    const labels = groups.map((g) =>
      within(g).getAllByRole('link').map((a) => a.querySelector('.shell-nav__label')?.textContent),
    );
    expect(labels).toEqual([
      ['Routes', 'Stream Routes', 'Services', 'Upstreams'],
      ['Consumers', 'Consumer Groups', 'SSL Certificates', 'Secrets'],
      ['Global Rules', 'Plugin Configs', 'Plugin Metadata'],
      ['Protos'],
    ]);
    // There is no Credentials entry: credentials live under their consumer.
    expect(nav().queryByText(t('kind.credentials.plural'))).toBeNull();
  });

  it('shows the logo, as decoration, before the app name in the brand link', () => {
    renderSidebar({});
    const brand = screen.getByRole('link', { name: t('shell.home') });
    const logo = brand.querySelector(':scope > img');
    expect(logo).toHaveAttribute('alt', '');
    expect(logo).toHaveAttribute('src', expect.stringMatching(/logo.*\.png$/));
    expect(logo).toHaveAttribute('width', '22');
    expect(logo).toHaveAttribute('height', '22');
    expect(logo?.nextSibling?.textContent).toBe(t('app.name'));
    expect(within(brand).getByText(t('app.name'))).toBeInTheDocument();
    expect(within(brand).queryByRole('img')).toBeNull();
  });

  it('shows … while a count loads', () => {
    renderSidebar({});
    expect(nav().getByRole('link', { name: `${t('kind.routes.plural')} …` })).toBeInTheDocument();
  });

  it('marks the current kind, also on its editor pages', async () => {
    renderSidebar({}, '/upstreams/u1');
    const link = nav().getByRole('link', { name: /^Upstreams/ });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: /^Routes/ })).not.toHaveAttribute('aria-current');
    await waitFor(() => expect(link).toHaveAccessibleName(`${t('kind.upstreams.plural')} 2`));
  });

  it('hides a kind this APISIX does not support', async () => {
    renderSidebar({
      replies: { stream_routes: () => json(400, { error_msg: 'stream mode is disabled, can not add stream routes' }) },
    });
    await waitFor(() => expect(nav().queryByText(t('kind.stream_routes.plural'))).toBeNull());
    expect(nav().getByRole('link', { name: /^Routes/ })).toBeInTheDocument();
  });

  it('marks a count that failed, and keeps the rest', async () => {
    renderSidebar({ replies: { upstreams: html502 } });
    const upstreams = nav().getByRole('link', { name: /^Upstreams/ });
    await waitFor(() => expect(upstreams.querySelector('.shell-nav__count--error')).not.toBeNull());
    expect(upstreams).toHaveAccessibleName(`${t('kind.upstreams.plural')} ${t('shell.countFailed', { error: 'HTTP 502: not an APISIX Admin API response' })}`);
    await waitFor(() => expect(nav().getByRole('link', { name: `${t('kind.routes.plural')} 10` })).toBeInTheDocument());
  });
});
