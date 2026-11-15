// The service editor as the registry wires it, on a fake Admin API: its tabs, the locked spec
// sheet, what Save sends from each tab, creating one, the Routes tab's link into the route editor,
// and a field that holds input Save must not skip.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
  await import('../routes/bodies');
  await import('../../upstream/UpstreamForm');
  await import('../../plugins/PluginsTab');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('svc.tab.general'), t('rt.tab.upstream'), t('pl.tab'), t('svc.tab.routes'), t('editor.json.tab')];

const UPSTREAMS: Obj[] = [
  { id: 'web-pool', name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] },
  { id: 'api-backend', name: 'api-backend', nodes: [{ host: 'backend.internal', port: 443, weight: 1 }] },
];
/** As dev/seed.mjs stores it, plus fields no form shows (`script`, which has no form, and an unknown key). */
const WEB: Obj = {
  id: 'web',
  name: 'web',
  desc: 'Public website',
  labels: { team: 'web' },
  hosts: ['apiseven.test', 'www.apiseven.test'],
  upstream_id: 'web-pool',
  plugins: { gzip: { comp_level: 5 } },
  enable_websocket: false,
  script: 'local _M = {} return _M',
  x_future: { kept: true },
  create_time: 1700000000,
  update_time: 1700000100,
};
const BILLING: Obj = { id: 'billing', name: 'billing', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] } };
const ROUTES: Obj[] = [
  { id: 'web-home', name: 'web-home', uri: '/*', service_id: 'web' },
  { id: 'invoices', name: 'invoices', uri: '/invoices', service_id: 'billing' },
];
const objects = (services: Obj[]) => ({ services, upstreams: UPSTREAMS, routes: ROUTES, stream_routes: [{ id: 'web-tcp', name: 'web-tcp', server_port: 9100, service_id: 'web' }] });

async function openService(service: Obj, hash = `#/services/${String(service.id)}`) {
  const app = await openEditor(hash, { objects: objects([service, BILLING]), replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: String(service.name) });
  return app;
}

/** Waits for the active tab's body (lazy, and its code editors and cards) to settle. */
async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"], .pl-note')).toBeNull());
  return panel;
}

/** The stored object as Save must send it back: without the timestamps, with `change` on top. */
const loadedWith = (stored: Obj, change: Obj): Obj => {
  const rest = { ...stored };
  delete rest.create_time;
  delete rest.update_time;
  return { ...rest, ...change };
};

describe('the service editor', () => {
  it('has General, Upstream, Plugins, Routes and JSON, and opens on General', async () => {
    await openService(WEB);
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('svc.tab.general'))).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['an upstream_id', WEB],
    ['an inline upstream', BILLING],
  ])('opened locked (%s), every field tab reads as text: no form controls', async (_, service) => {
    const { user } = await openService(service);
    // Routes owns no field: it lists other objects, with a search box and menus of their own.
    for (const label of TAB_LABELS().slice(0, 3)) {
      await user.click(tab(label));
      const panel = await settled();
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it('locked, the spec sheet: hosts in mono, the upstream it resolves to, the routes using it', async () => {
    await openService(WEB);
    expect(main().getByText('www.apiseven.test')).toHaveClass('mono');
    const overview = main().getByRole('region', { name: t('svc.overview') });
    expect(overview).toHaveTextContent('web-pool');
    expect(overview).toHaveTextContent(t('svc.overview.script'));
    await waitFor(() => expect(overview).toHaveTextContent(`${t('svc.overview.routeOne')}${t('svc.overview.streamOne')}`));
  });
});

describe('a save from each tab sends every field the tab does not own exactly as loaded', () => {
  const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

  it('General: hosts', async () => {
    const { user, admin } = await openService(WEB);
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('svc.general.hosts') }), 'blog.apiseven.test{Enter}');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const [put] = writesOf(admin);
    expect(put?.method).toBe('PUT');
    expect(put?.path).toBe('services/web');
    expect(put?.body).toEqual(loadedWith(WEB, { hosts: ['apiseven.test', 'www.apiseven.test', 'blog.apiseven.test'] }));
  });

  it('Upstream: another upstream', async () => {
    const { user, admin } = await openService(WEB, '#/services/web?tab=upstream');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('combobox', { name: t('rt.up.upstream') }));
    await user.click(await screen.findByRole('option', { name: /api-backend/ }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(WEB, { upstream_id: 'api-backend' }));
  });

  it('Plugins: a plugin switched off', async () => {
    const { user, admin } = await openService(WEB, '#/services/web?tab=plugins');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: 'Enable gzip' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(WEB, { plugins: { gzip: { comp_level: 5, _meta: { disable: true } } } }));
  });
});

describe('creating a service', () => {
  it('with an inline upstream and a plugin: the POST carries exactly those', async () => {
    const { user, admin } = await openEditor('#/services/new', { objects: objects([]), replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('textbox', { name: t('svc.general.name') }), 'shop-api');

    await user.click(tab(t('rt.tab.upstream')));
    await settled();
    expect(main().getByRole('radio', { name: t('rt.up.source.inline') })).toBeChecked();
    await user.click(main().getByRole('textbox', { name: t('up.nodes.new') }));
    await user.paste('10.0.1.20:3000');

    await user.click(tab(t('pl.tab')));
    await settled();
    await user.click(main().getByRole('button', { name: t('pl.add') }));
    const picker = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    await user.type(within(picker).getByRole('combobox', { name: t('pl.picker.search') }), 'cors');
    await user.click(within(picker).getByRole('option', { name: /^cors\b/ }));

    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const [post] = writesOf(admin);
    expect(post?.method).toBe('POST');
    expect(post?.path).toBe('services');
    expect(post?.body).toEqual({ name: 'shop-api', upstream: { nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] }, plugins: { cors: {} } });
  });

  it('with nothing but a name: a service needs no upstream', async () => {
    const { user, admin } = await openEditor('#/services/new', { objects: objects([]), replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('textbox', { name: t('svc.general.name') }), 'bare');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ name: 'bare' });
  });
});

describe('the Routes tab', () => {
  it('lists the routes using it; "New route in this service" opens a route that starts with its service_id', async () => {
    const { user, admin } = await openService(WEB, '#/services/web?tab=routes');
    await settled();
    const routes = main().getByRole('region', { name: t('kind.routes.plural') });
    expect(await within(routes).findByRole('link', { name: 'web-home' })).toBeInTheDocument();
    expect(within(routes).queryByText('invoices')).not.toBeInTheDocument();

    await user.click(within(routes).getAllByRole('link', { name: t('svc.routes.newRoute') })[0] as HTMLElement);
    await main().findByRole('button', { name: t('editor.create') });
    await user.click(tab(t('rt.tab.upstream')));
    await settled();
    expect(main().getByRole('radio', { name: t('rt.up.source.service') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toMatchObject({ method: 'POST', path: 'routes', body: { uri: '/*', status: 1, service_id: 'web' } });
  });
});

describe('what the General tab shows is what gets saved', () => {
  const saveKeys = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

  it('host text typed without Enter is saved by Cmd/Ctrl-S; a host APISIX refuses blocks Save, naming Hosts', async () => {
    const { user, admin } = await openService(WEB);
    await settled();
    await user.keyboard('e');
    const hosts = main().getByRole('textbox', { name: t('svc.general.hosts') });

    await user.type(hosts, 'bad host');
    saveKeys();
    const held = t('ui.pending.tag', { field: t('svc.general.hosts'), text: 'bad host', reason: t('rt.issue.host', { host: 'bad host' }) });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held })));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(t('svc.tab.general'))).toHaveAccessibleName(`${t('svc.tab.general')} ${t('ui.tabs.errors', { count: 1 })}`);

    await user.click(tab(t('rt.tab.upstream')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(held);
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));

    await user.clear(hosts);
    await user.type(hosts, 'b.apiseven.test');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.hosts).toEqual(['apiseven.test', 'www.apiseven.test', 'b.apiseven.test']);
  });
});
