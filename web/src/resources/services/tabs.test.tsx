// The service editor's tabs, each rendered as the frame renders it (controlled by the draft).
import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { json } from '../../test/fakeAdmin';
import { editableControls } from '../../test/schemaForm';
import { renderTab, type TabOptions } from '../../test/tab';
import type { TabProps } from '../registry';
import { GeneralTab, RoutesTab, UpstreamTab } from './bodies';
import { serviceIssues } from './validate';

beforeAll(async () => {
  await import('../../upstream/UpstreamForm');
});

const CTX = ctxOf({
  upstreams: [itemOf('web-pool', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
  services: [itemOf('web', { name: 'web', upstream_id: 'web-pool' }), itemOf('billing', { name: 'billing' })],
  routes: [
    itemOf('web-home', { name: 'web-home', uri: '/*', service_id: 'web' }),
    itemOf('web-blog', { name: 'web-blog', uri: '/blog/*', service_id: 'web' }),
    itemOf('invoices', { name: 'invoices', uri: '/invoices', service_id: 'billing' }),
    itemOf('loose', { name: 'loose', uri: '/loose' }),
  ],
  streamRoutes: [itemOf('web-tcp', { name: 'web-tcp', server_port: 9100, service_id: 'web' }), itemOf('other-tcp', { name: 'other-tcp', server_port: 9101 })],
});

/** As dev/seed.mjs stores it, with every General field set. */
const WEB: Obj = { id: 'web', name: 'web', desc: 'Public website', labels: { team: 'web' }, hosts: ['apiseven.test', 'www.apiseven.test'], upstream_id: 'web-pool', plugins: { gzip: { comp_level: 5 } }, enable_websocket: true };

const tab = (Tab: ComponentType<TabProps>, draft: Obj, opts: TabOptions = {}) =>
  renderTab('services', Tab, draft, serviceIssues, { ctx: CTX, original: { id: typeof draft.id === 'string' ? draft.id : 'web', value: draft }, ...opts });

describe('every tab of a full service, locked, reads as text', () => {
  it.each([
    ['General', GeneralTab],
    ['Upstream', UpstreamTab],
  ])('%s: no form controls', async (_, Tab) => {
    const { container } = tab(Tab, WEB, { locked: true });
    await waitFor(() => expect(container.querySelector('.ed-lazy__loading')).toBeNull());
    expect(editableControls(container)).toEqual([]);
  });
});

describe('General', () => {
  it('edits name, description, labels and hosts; a host APISIX refuses is held, named Hosts', async () => {
    const h = tab(GeneralTab, { id: 'web', name: 'web' });
    await h.user.type(screen.getByRole('textbox', { name: t('svc.general.desc') }), 'Site');
    await h.user.type(screen.getByRole('textbox', { name: t('svc.general.hosts') }), 'apiseven.test{Enter}*.apiseven.test,');
    expect(h.value()).toEqual({ id: 'web', name: 'web', desc: 'Site', hosts: ['apiseven.test', '*.apiseven.test'] });

    const hosts = screen.getByRole('textbox', { name: t('svc.general.hosts') });
    await h.user.type(hosts, 'bad host{Enter}');
    expect(hosts).toHaveAttribute('aria-invalid', 'true');
    expect(h.held()).toEqual([t('ui.pending.tag', { field: t('svc.general.hosts'), text: 'bad host', reason: t('rt.issue.host', { host: 'bad host' }) })]);
    expect(h.value().hosts).toEqual(['apiseven.test', '*.apiseven.test']);
  });

  it('removing the last host removes hosts', async () => {
    const h = tab(GeneralTab, { id: 'web', hosts: ['apiseven.test'] });
    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: 'apiseven.test' }) }));
    expect(h.value()).toEqual({ id: 'web' });
  });

  it('a stored host the schema takes is shown; one it refuses is flagged at its place', () => {
    tab(GeneralTab, { id: 'web', hosts: ['ok.example', 'bad host'] });
    expect(screen.getByRole('textbox', { name: t('svc.general.hosts') })).toHaveAccessibleDescription(new RegExp(t('rt.issue.host', { host: 'bad host' }).slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('WebSocket: on writes true; off removes it (unset and false both leave it off, apisix/init.lua)', async () => {
    const h = tab(GeneralTab, { id: 'web' });
    const ws = screen.getByRole('switch', { name: t('svc.general.websocket') });
    await h.user.click(ws);
    expect(h.value()).toEqual({ id: 'web', enable_websocket: true });
    await h.user.click(ws);
    expect(h.value()).toEqual({ id: 'web' });
  });

  it('WebSocket stored as false: on, then off again, gives back false', async () => {
    const h = tab(GeneralTab, { id: 'web', enable_websocket: false }, { original: { id: 'web', value: { id: 'web', enable_websocket: false } } });
    const ws = screen.getByRole('switch', { name: t('svc.general.websocket') });
    expect(ws).not.toBeChecked();
    await h.user.click(ws);
    await h.user.click(ws);
    expect(h.value()).toEqual({ id: 'web', enable_websocket: false });
  });

  it('locked: hosts as mono chips; none says what that means; WebSocket on or off', () => {
    tab(GeneralTab, WEB, { locked: true });
    expect(screen.getByText('www.apiseven.test')).toHaveClass('mono');
    expect(screen.getByText(t('ui.on'))).toBeInTheDocument();
  });

  it('locked without hosts or WebSocket', () => {
    tab(GeneralTab, { id: 'bare', name: 'bare' }, { locked: true });
    expect(screen.getByText(t('svc.general.noHosts'))).toBeInTheDocument();
    expect(screen.getByText(t('ui.off'))).toBeInTheDocument();
  });

  it('the overview: the upstream it resolves to, its plugins, and the routes using it, each linking to its tab', async () => {
    tab(GeneralTab, WEB, { locked: true });
    const overview = screen.getByRole('region', { name: t('svc.overview') });
    expect(within(overview).getByRole('link', { name: t('rt.tab.upstream') })).toHaveAttribute('href', '/?tab=upstream');
    expect(overview).toHaveTextContent('web-pool');
    expect(overview).toHaveTextContent('10.0.0.11:8080');
    expect(overview).toHaveTextContent('gzip');
    await waitFor(() => expect(overview).toHaveTextContent(`${t('svc.overview.routeCount', { count: 2 })}${t('svc.overview.streamOne')}`));
    expect(within(overview).getByRole('link', { name: t('svc.tab.routes') })).toHaveAttribute('href', '/?tab=routes');
  });

  it('the overview says "loading…" while the lists it depends on load, never "none"', () => {
    tab(GeneralTab, WEB, { locked: true, ctx: ctxOf({ loaded: { routes: false, upstreams: false } }) });
    const overview = screen.getByRole('region', { name: t('svc.overview') });
    expect(overview.textContent?.split(t('picker.loading')).length).toBeGreaterThanOrEqual(3);
    expect(overview).not.toHaveTextContent(t('svc.overview.noRoutes'));
  });

  it('the overview of a service without an upstream, plugins or routes', async () => {
    tab(GeneralTab, { id: 'bare', name: 'bare' }, { locked: true });
    const overview = screen.getByRole('region', { name: t('svc.overview') });
    expect(overview).toHaveTextContent(t('svc.up.resolvesNone'));
    expect(overview).toHaveTextContent(t('svc.overview.noPlugins'));
    await waitFor(() => expect(overview).toHaveTextContent(t('svc.overview.noRoutes')));
  });
});

describe('Upstream', () => {
  it('Existing or Inline only: a service has no service of its own', () => {
    tab(UpstreamTab, WEB);
    const group = screen.getByRole('radiogroup', { name: t('rt.up.source') });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: t('rt.up.service') })).not.toBeInTheDocument();
  });
});

describe('Routes', () => {
  it('lists only the routes and stream routes with this service_id, each with Edit only', async () => {
    const h = tab(RoutesTab, WEB);
    const routes = await screen.findByRole('region', { name: t('kind.routes.plural') });
    expect(await within(routes).findByRole('link', { name: 'web-home' })).toHaveAttribute('href', '/routes/web-home');
    expect(within(routes).getByRole('link', { name: 'web-blog' })).toBeInTheDocument();
    expect(within(routes).queryByText('invoices')).not.toBeInTheDocument();
    expect(within(routes).queryByText('loose')).not.toBeInTheDocument();

    const streams = screen.getByRole('region', { name: t('kind.stream_routes.plural') });
    expect(await within(streams).findByRole('link', { name: 'web-tcp' })).toHaveAttribute('href', '/stream_routes/web-tcp');
    expect(within(streams).queryByText('other-tcp')).not.toBeInTheDocument();

    await h.user.click(within(routes).getAllByRole('button', { name: t('table.actionsFor', { name: 'web-blog' }) })[0] as HTMLElement);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([t('action.edit')]);
    await h.user.click(within(menu).getByRole('menuitem', { name: t('action.edit') }));
    expect(h.router.state.location.pathname).toBe('/routes/web-blog');
  });

  it.each([
    ['locked', true],
    ['editing', false],
  ])('%s: a route\'s status is words only, never a switch; clicking it writes nothing (fix round 1)', async (_, locked) => {
    const h = tab(RoutesTab, WEB, { locked, admin: { objects: { routes: [{ id: 'web-home', uri: '/*', service_id: 'web', status: 1 }] } } });
    const routes = await screen.findByRole('region', { name: t('kind.routes.plural') });
    await within(routes).findByRole('link', { name: 'web-home' });
    expect(within(routes).queryAllByRole('switch')).toEqual([]);
    await h.user.click(within(routes).getAllByText(t('table.status.enabled'))[0] as HTMLElement);
    expect(h.admin.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    expect(editableControls(routes)).toEqual([]);
  });

  it('locked, the tables are still lists to work with: the service\'s lock is not theirs (page size, columns)', async () => {
    tab(RoutesTab, WEB, { locked: true });
    const routes = await screen.findByRole('region', { name: t('kind.routes.plural') });
    await within(routes).findByRole('link', { name: 'web-home' });
    expect(within(routes).getByRole('combobox', { name: t('table.page.size') })).toBeEnabled();
  });

  it('the new-route links carry the service id', async () => {
    tab(RoutesTab, WEB);
    expect(await screen.findByRole('link', { name: t('svc.routes.newRoute') })).toHaveAttribute('href', '/routes/~new?service_id=web');
    expect(screen.getByRole('link', { name: t('svc.routes.newStreamRoute') })).toHaveAttribute('href', '/stream_routes/~new?service_id=web');
  });

  it('with no routes using it, each table says so and still offers the new-route link', async () => {
    tab(RoutesTab, { id: 'lonely', name: 'lonely' }, { original: { id: 'lonely', value: { id: 'lonely' } } });
    const routes = await screen.findByRole('region', { name: t('kind.routes.plural') });
    expect(within(routes).getByText(t('svc.routes.noRoutes'))).toBeInTheDocument();
    expect(within(routes).getAllByRole('link', { name: t('svc.routes.newRoute') }).length).toBeGreaterThan(0);
  });

  it('a new, unsaved service shows a note instead of the tables', () => {
    tab(RoutesTab, {}, { isNew: true, original: undefined });
    expect(screen.getByText(t('svc.routes.newNote'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('with stream mode off (APISIX answers 400 for stream_routes), only the routes table', async () => {
    tab(RoutesTab, WEB, { admin: { replies: { stream_routes: () => json(400, { error_msg: 'stream mode is disabled, can not add stream routes' }) } } });
    await screen.findByRole('region', { name: t('kind.routes.plural') });
    await waitFor(() => expect(screen.queryByRole('region', { name: t('kind.stream_routes.plural') })).not.toBeInTheDocument());
  });
});
