// The stream route editor as the registry wires it, on a fake Admin API: its tabs, the locked spec
// sheet, creating one, the create page's prefill, the stream plugin set, what Save sends from each
// tab, and fields that hold input Save must not skip.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { pluginFixture } from '../../test/pluginFixture';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
  await import('../../upstream/UpstreamForm');
  await import('../../plugins/PluginsTab');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('sr.tab.general'), t('sr.tab.matching'), t('rt.tab.upstream'), t('pl.tab'), t('sr.tab.advanced'), t('editor.json.tab')];

const UPSTREAMS: Obj[] = [
  { id: 'web-pool', name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] },
  { id: 'api-backend', name: 'api-backend', nodes: [{ host: 'backend.internal', port: 443, weight: 1 }] },
];
const SERVICES: Obj[] = [{ id: 'web', name: 'web', upstream_id: 'web-pool' }];
/** As dev/seed.mjs stores it, plus fields no form shows (an unknown key) and the advanced ones. */
const ETCD: Obj = {
  id: 'etcd-tcp',
  name: 'etcd-tcp',
  desc: 'TCP 9100 to the dev etcd',
  labels: { env: 'dev' },
  server_port: 9100,
  remote_addr: '127.0.0.0/8',
  snis: ['a.example', 'b.example'],
  plugins: { 'limit-conn': { conn: 100, burst: 50, default_conn_delay: 0.1, key: 'remote_addr' } },
  // pass_host and keepalive_pool have no effect on a stream upstream; they are kept as stored (Ruling 2).
  upstream: { type: 'roundrobin', nodes: [{ host: 'etcd', port: 2379, weight: 1 }], pass_host: 'node', keepalive_pool: { size: 8 } },
  protocol: { name: 'redis', conf: { faults: [] } },
  x_future: { kept: true },
  create_time: 1700000000,
  update_time: 1700000100,
};
const VIA_SERVICE: Obj = { id: 'via', name: 'via-service', server_port: 9101, service_id: 'web' };
const objects = (streamRoutes: Obj[]) => ({ stream_routes: streamRoutes, upstreams: UPSTREAMS, services: SERVICES });

async function openStream(route: Obj, hash = `#/stream_routes/${String(route.id)}`) {
  const app = await openEditor(hash, { objects: objects([route]), replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: String(route.name) });
  return app;
}

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"], .pl-note')).toBeNull());
  return panel;
}

const loadedWith = (stored: Obj, change: Obj): Obj => {
  const rest = { ...stored };
  delete rest.create_time;
  delete rest.update_time;
  return { ...rest, ...change };
};

describe('the stream route editor', () => {
  it('has General, Matching, Upstream, Plugins, Advanced and JSON, and opens on General', async () => {
    await openStream(ETCD);
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('sr.tab.general'))).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['an inline upstream and a protocol', ETCD],
    ['a service', VIA_SERVICE],
  ])('opened locked (%s), every tab reads as text: no form controls', async (_, route) => {
    const { user } = await openStream(route);
    for (const label of TAB_LABELS().slice(0, 5)) {
      await user.click(tab(label));
      const panel = await settled();
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it('the Plugins picker offers only the stream plugins', async () => {
    const { user } = await openEditor('#/stream_routes/new?tab=plugins', { objects: objects([]), replies: pluginReplies() });
    await settled();
    await user.click(main().getByRole('button', { name: t('pl.add') }));
    const picker = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    const offered = within(picker).getAllByRole('option').map((o) => o.getAttribute('data-plugin'));
    expect(offered.sort()).toEqual(Object.keys(pluginFixture().stream).sort());
    expect(within(picker).queryByRole('option', { name: /^cors\b/ })).not.toBeInTheDocument();
  });
});

describe('the inline upstream in the stream subsystem (Ruling 2)', () => {
  it('stored http-only settings show with a note, locked and editing; an unrelated save keeps them', async () => {
    const { user, admin } = await openStream(ETCD, '#/stream_routes/etcd-tcp?tab=upstream');
    await settled();
    expect(main().getAllByText(t('up.stream.noEffect'))).toHaveLength(2);
    await user.keyboard('e');
    expect(main().getAllByText(t('up.stream.noEffect'))).toHaveLength(2);
    // Only the L4 schemes, tcp by default.
    await user.click(main().getByRole('combobox', { name: t('up.conn.scheme') }));
    const offered = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual([t('up.default', { value: 'tcp' }), 'tcp', 'tls', 'udp']);
    await user.keyboard('{Escape}');
    await user.click(tab(t('sr.tab.general')));
    await user.type(main().getByRole('textbox', { name: t('sr.general.desc') }), '!');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.upstream).toEqual(ETCD.upstream);
  });
});

describe('creating a stream route', () => {
  it('on port 9100 with an existing upstream: the POST carries exactly those, the port a number', async () => {
    const { user, admin } = await openEditor('#/stream_routes/new?tab=matching', { objects: objects([]), replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('spinbutton', { name: t('sr.match.serverPort') }), '9100');
    await user.click(tab(t('rt.tab.upstream')));
    await settled();
    await user.click(main().getByRole('radio', { name: t('rt.up.source.existing') }));
    await user.click(main().getByRole('combobox', { name: t('rt.up.upstream') }));
    await user.click(await screen.findByRole('option', { name: /web-pool/ }));
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'POST', path: 'stream_routes', body: { server_port: 9100, upstream_id: 'web-pool' } });
  });

  it('the create page copies service_id and upstream_id; a param the kind does not list is ignored', async () => {
    const { user, admin } = await openEditor('#/stream_routes/new?service_id=web&upstream_id=api-backend&name=nope&tab=upstream', { objects: objects([]), replies: pluginReplies() });
    await settled();
    expect(main().getByRole('radio', { name: t('rt.up.source.existing') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ service_id: 'web', upstream_id: 'api-backend' });
  });

  it('from a service\'s link: starts on the service\'s upstream', async () => {
    const { user, admin } = await openEditor('#/stream_routes/new?service_id=web&tab=upstream', { objects: objects([]), replies: pluginReplies() });
    await settled();
    expect(main().getByRole('radio', { name: t('rt.up.source.service') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ service_id: 'web' });
  });
});

describe('a save from each tab sends every field the tab does not own exactly as loaded', () => {
  const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));
  const edit = async (tabId: string) => {
    const app = await openStream(ETCD, `#/stream_routes/etcd-tcp?tab=${tabId}`);
    await settled();
    await app.user.keyboard('e');
    return app;
  };

  it('General: the description', async () => {
    const { user, admin } = await edit('general');
    await user.type(main().getByRole('textbox', { name: t('sr.general.desc') }), '!');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PUT', path: 'stream_routes/etcd-tcp', body: loadedWith(ETCD, { desc: 'TCP 9100 to the dev etcd!' }) });
  });

  it('Matching: the port, and a server address emptied again', async () => {
    const { user, admin } = await edit('matching');
    const port = main().getByRole('spinbutton', { name: t('sr.match.serverPort') });
    await user.clear(port);
    await user.type(port, '9200');
    const addr = main().getByRole('textbox', { name: t('sr.match.serverAddr') });
    await user.type(addr, '127.0.0.1');
    await user.clear(addr);
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(ETCD, { server_port: 9200 }));
  });

  it('Upstream: Inline → Existing (asked first)', async () => {
    const { user, admin } = await edit('upstream');
    await user.click(main().getByRole('radio', { name: t('rt.up.source.existing') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('rt.up.discard.confirm') }));
    await user.click(main().getByRole('combobox', { name: t('rt.up.upstream') }));
    await user.click(await screen.findByRole('option', { name: /api-backend/ }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const expected = loadedWith(ETCD, { upstream_id: 'api-backend' });
    delete expected.upstream;
    expect(writesOf(admin)[0]?.body).toEqual(expected);
  });

  it('Plugins: a plugin switched off', async () => {
    const { user, admin } = await edit('plugins');
    await user.click(main().getByRole('switch', { name: 'Enable limit-conn' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(ETCD, { plugins: { 'limit-conn': { ...(ETCD.plugins as Obj)['limit-conn'] as Obj, _meta: { disable: true } } } }));
  });

  it('Advanced: TLS passthrough on', async () => {
    const { user, admin } = await edit('advanced');
    await user.click(main().getByRole('switch', { name: t('sr.adv.passthrough') }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(ETCD, { tls_passthrough: true }));
  });
});

describe('what the fields show is what gets saved', () => {
  const saveKeys = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

  it('an SNI APISIX refuses blocks Save (button and Cmd/Ctrl-S), naming SNIs; fixed, the PUT has the list shown', async () => {
    const { user, admin } = await openStream(ETCD, '#/stream_routes/etcd-tcp?tab=matching');
    await settled();
    await user.keyboard('e');
    const snis = main().getByRole('textbox', { name: t('sr.match.snis') });
    await user.type(snis, 'bad host');
    saveKeys();
    const held = t('ui.pending.tag', { field: t('sr.match.snis'), text: 'bad host', reason: t('rt.issue.host', { host: 'bad host' }) });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held })));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(t('sr.tab.matching'))).toHaveAccessibleName(`${t('sr.tab.matching')} ${t('ui.tabs.errors', { count: 1 })}`);

    await user.click(tab(t('sr.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(held);
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));

    await user.clear(snis);
    await user.type(snis, 'c.example');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(ETCD, { snis: ['a.example', 'b.example', 'c.example'] }));
  });

  it('protocol conf JSON that does not parse blocks Save, naming protocol.conf; the stored conf stays in the draft', async () => {
    const { user, admin } = await openStream(ETCD, '#/stream_routes/etcd-tcp?tab=advanced');
    await settled();
    await user.keyboard('e');
    const conf = await main().findByRole('textbox', { name: t('sf.json.label', { key: 'conf' }) });
    await user.click(conf);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('{"faults": [');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    const held = t('ui.pending.json', { field: 'protocol.conf' });
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held }));
    expect(writesOf(admin)).toEqual([]);

    // Discarded on a tab switch: the stored conf is what the draft still has; another change saves it unchanged.
    await user.click(tab(t('sr.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.discard') }));
    await settled();
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: t('sr.general.desc') }), '!');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(ETCD, { desc: 'TCP 9100 to the dev etcd!' }));
  });
});
