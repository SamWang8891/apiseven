// The route editor as the registry wires it, on a fake Admin API: its tabs, the locked spec sheet,
// what Save sends, the create page's prefill, and fields that hold input Save must not skip.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { newPathFor } from '../../router/paths';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
  await import('../../upstream/UpstreamForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

/** A tab by its label (its name also counts its problems). */
const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('rt.tab.general'), t('rt.tab.matching'), t('rt.tab.upstream'), t('pl.tab'), t('rt.tab.advanced'), t('editor.json.tab')];

const UPSTREAMS: Obj[] = [
  { id: 'api-backend', name: 'api-backend', type: 'chash', hash_on: 'header', key: 'x-user-id', nodes: [{ host: 'backend.internal', port: 443, weight: 10 }] },
  { id: 'web-pool', name: 'web-pool', type: 'roundrobin', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] },
];
const SERVICES: Obj[] = [{ id: 'web', name: 'web', hosts: ['apiseven.test'], upstream_id: 'web-pool', plugins: { gzip: { comp_level: 5 } } }];
const PLUGIN_CONFIGS: Obj[] = [{ id: 'common-headers', name: 'common-headers', plugins: { 'response-rewrite': { headers: { set: { 'X-Served-By': 'apisix' } } } } }];

/** As dev/seed.mjs stores it, plus a field no form shows. */
const API_V1: Obj = {
  id: 'api-v1',
  name: 'api-v1',
  host: 'api.apiseven.test',
  uris: ['/v1', '/v1/*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  upstream_id: 'api-backend',
  labels: { team: 'core', env: 'dev' },
  plugins: { 'key-auth': {}, 'limit-count': { count: 100, time_window: 60, rejected_code: 429, key_type: 'var', key: 'remote_addr' } },
  vars: [['http_x_tenant', '~~', '^[a-z0-9-]+$']],
  x_future: { kept: true },
  status: 1,
  create_time: 1700000000,
  update_time: 1700000100,
};
const SHOP: Obj = {
  id: 'shop',
  name: 'shop',
  host: 'shop.apiseven.test',
  uri: '/*',
  plugin_config_id: 'common-headers',
  upstream: { type: 'roundrobin', nodes: [{ host: '10.0.2.10', port: 8080, weight: 3 }] },
};
const WEB_HOME: Obj = { id: 'web-home', name: 'web-home', desc: 'Website pages', uri: '/*', service_id: 'web' };
const objects = (routes: Obj[]) => ({ routes, upstreams: UPSTREAMS, services: SERVICES, plugin_configs: PLUGIN_CONFIGS });

async function openRoute(route: Obj, hash = `#/routes/${String(route.id)}`) {
  const app = await openEditor(hash, { objects: objects([route]), replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: String(route.name) });
  return app;
}

/** Waits for the active tab's body (lazy, and its code editors and cards) to settle. */
async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"], .pl-note')).toBeNull());
  return panel;
}

describe('the route editor', () => {
  it('has General, Matching, Upstream, Plugins, Advanced and JSON, and opens on General', async () => {
    await openRoute(API_V1);
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('rt.tab.general'))).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['upstream_id', API_V1],
    ['an inline upstream', SHOP],
    ['a service', WEB_HOME],
  ])('opened locked (%s), every tab reads as text: no form controls', async (_, route) => {
    const { user } = await openRoute(route);
    for (const label of TAB_LABELS().slice(0, 5)) {
      await user.click(tab(label));
      const panel = await settled();
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it('locked, the spec sheet: hosts and URIs as mono chips, methods as chips, the resolved upstream', async () => {
    const { user } = await openRoute(API_V1);
    const overview = (await main().findByRole('region', { name: t('rt.overview') }));
    expect(overview).toHaveTextContent('api.apiseven.test');
    expect(overview).toHaveTextContent('api-backend');
    await user.click(tab(t('rt.tab.matching')));
    await settled();
    expect(within(main().getByRole('group', { name: t('rt.match.hosts') })).getByText('api.apiseven.test')).toHaveClass('mono');
    expect(within(main().getByRole('group', { name: t('rt.match.methods') })).getByText('DELETE')).toBeInTheDocument();
    await user.click(tab(t('rt.tab.upstream')));
    await settled();
    expect(main().getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent('backend.internal:443');
  });

  it('a host list changed from one to two is saved as hosts (no host), and every other field as loaded', async () => {
    const { user, admin } = await openRoute(API_V1, '#/routes/api-v1?tab=matching');
    await settled();
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('rt.match.hosts') }), 'api-eu.apiseven.test{Enter}');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const [put] = writesOf(admin);
    expect(put?.method).toBe('PUT');
    expect(put?.path).toBe('routes/api-v1');
    const loaded: Obj = { ...API_V1 };
    for (const key of ['create_time', 'update_time', 'host']) delete loaded[key];
    expect(put?.body).toEqual({ ...loaded, hosts: ['api.apiseven.test', 'api-eu.apiseven.test'] });
  });

  it('a new route starts on Inline with the node table, and an empty one can\'t be created', async () => {
    const { user, admin } = await openEditor('#/routes/new?tab=upstream', { objects: objects([]), replies: pluginReplies() });
    await settled();
    expect(main().getByRole('radio', { name: t('rt.up.source.inline') })).toBeChecked();
    expect(main().getByRole('textbox', { name: t('up.nodes.new') })).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') }));
    expect(tab(t('rt.tab.upstream'))).toHaveAccessibleName(`${t('rt.tab.upstream')} ${t('ui.tabs.errors', { count: 1 })}`);
    expect(main().getByRole('radiogroup', { name: t('rt.up.source') })).toHaveAccessibleDescription(t('rt.issue.nothing'));

    // A node typed in makes it a route APISIX takes.
    await user.click(main().getByRole('textbox', { name: t('up.nodes.new') }));
    await user.paste('10.0.0.5:8080');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ uri: '/*', status: 1, upstream: { nodes: [{ host: '10.0.0.5', port: 8080, weight: 1 }] } });
  });
});

describe('a new route opens without red (Task 16b, item 154)', () => {
  it('"Choose where requests go" waits for a refused Create: no badge, no message; then both, on the Upstream tab', async () => {
    const { user, admin } = await openEditor('#/routes/~new', { objects: objects([]), replies: pluginReplies() });
    await settled();
    for (const label of TAB_LABELS()) expect(tab(label)).toHaveAccessibleName(label);
    // Typing elsewhere touches only that field.
    await user.type(main().getByRole('textbox', { name: /^Name/ }), 'shop');
    expect(tab(t('rt.tab.upstream'))).toHaveAccessibleName(t('rt.tab.upstream'));
    await user.click(tab(t('rt.tab.upstream')));
    await settled();
    expect(main().getByRole('radiogroup', { name: t('rt.up.source') })).not.toHaveAccessibleDescription(t('rt.issue.nothing'));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(tab(t('rt.tab.upstream'))).toHaveAccessibleName(`${t('rt.tab.upstream')} ${t('ui.tabs.errors', { count: 1 })}`));
    expect(main().getByRole('radiogroup', { name: t('rt.up.source') })).toHaveAccessibleDescription(t('rt.issue.nothing'));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') }));
    expect(writesOf(admin)).toEqual([]);
  });

  it('a required value the user emptied shows at once: the URI cleared', async () => {
    const { user } = await openEditor('#/routes/~new?tab=matching', { objects: objects([]), replies: pluginReplies() });
    await settled();
    expect(tab(t('rt.tab.matching'))).toHaveAccessibleName(t('rt.tab.matching'));
    await user.click(main().getByRole('button', { name: t('ui.tags.remove', { tag: '/*' }) }));
    await waitFor(() => expect(tab(t('rt.tab.matching'))).toHaveAccessibleName(`${t('rt.tab.matching')} ${t('ui.tabs.errors', { count: 1 })}`));
    expect(main().getByText(t('rt.issue.noUri'))).toBeInTheDocument();
    // The Upstream tab's problem still waits for a Save.
    expect(tab(t('rt.tab.upstream'))).toHaveAccessibleName(t('rt.tab.upstream'));
  });
});

describe('a new route: a plugin card added is not all in red (Task 16b, item 154; fix round 1, R1)', () => {
  const plugins = () => tab(t('pl.tab'));
  const count = () => main().getByRole('textbox', { name: 'count (required)' });

  async function addLimitCount(user: Awaited<ReturnType<typeof openEditor>>['user']) {
    await user.click(await main().findByRole('button', { name: t('pl.add') }));
    const picker = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    await user.type(within(picker).getByRole('combobox', { name: t('pl.picker.search') }), 'limit-count');
    await user.click(within(picker).getByRole('option', { name: /^limit-count\b/ }));
    await main().findByRole('textbox', { name: 'count (required)' });
  }

  it('its required fields wait for a refused Save: no error, no badge; then all of them', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('routes')}?tab=plugins`, { objects: objects([]), replies: pluginReplies() });
    await settled();
    await addLimitCount(user);
    expect(count()).not.toHaveAccessibleDescription(expect.stringContaining(t('schema.required')) as string);
    expect(plugins()).toHaveAccessibleName(t('pl.tab'));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(plugins()).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 2 })}`));
    expect(count()).toHaveAccessibleDescription(expect.stringContaining(t('schema.required')) as string);
    expect(writesOf(admin)).toEqual([]);
  });

  it('a value typed into a required field and cleared again shows its error at once; the other waits', async () => {
    const { user } = await openEditor(`#${newPathFor('routes')}?tab=plugins`, { objects: objects([]), replies: pluginReplies() });
    await settled();
    await addLimitCount(user);
    await user.type(count(), '5');
    await user.clear(count());
    await waitFor(() => expect(count()).toHaveAccessibleDescription(expect.stringContaining(t('schema.required')) as string));
    expect(plugins()).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 1 })}`);
    expect(main().getByRole('textbox', { name: 'time_window (required)' })).not.toHaveAccessibleDescription(expect.stringContaining(t('schema.required')) as string);
  });

  it('the JSON tab: a null typed over nothing is a value entered, and its problem shows at once (fix round 2, M1)', async () => {
    const { user } = await openEditor(`#${newPathFor('routes')}?tab=json`, { objects: objects([]), replies: pluginReplies() });
    const box = await jsonEditor(t('kind.routes.singular'));
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ uri: '/a', status: 1, priority: null }));
    await waitFor(() => expect(tab(t('rt.tab.general'))).toHaveAccessibleName(`${t('rt.tab.general')} ${t('ui.tabs.errors', { count: 1 })}`));
  });

  it('the JSON tab: a plugin pasted in without its required settings waits; a value of the wrong type shows at once', async () => {
    const { user } = await openEditor(`#${newPathFor('routes')}?tab=json`, { objects: objects([]), replies: pluginReplies() });
    const box = await jsonEditor(t('kind.routes.singular'));
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ uri: '/a', status: 1, plugins: { 'limit-count': {} } }));
    await waitFor(() => expect(box).toHaveTextContent('limit-count'));
    for (const label of TAB_LABELS()) expect(tab(label)).toHaveAccessibleName(label);
    expect(main().queryByRole('region', { name: t('editor.issues') })).toBeNull();
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ uri: '/a', status: 1, plugins: { 'limit-count': { count: -1 } } }));
    await waitFor(() => expect(plugins()).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 1 })}`));
  });
});

describe('an inline upstream emptied of its nodes (Ruling 1)', () => {
  it('is saved as APISIX stores it: the route has an upstream, with an empty node list', async () => {
    const { user, admin } = await openEditor('#/routes/new?tab=upstream', { objects: objects([]), replies: pluginReplies() });
    await settled();
    await user.click(main().getByRole('textbox', { name: t('up.nodes.new') }));
    await user.paste('10.0.0.5:8080');
    await user.click(main().getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    expect(main().getByText(t('up.nodes.emptyNote'))).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ uri: '/*', status: 1, upstream: { nodes: [] } });
  });
});

// Final wave E2: an overview link changes only `tab`; the Duplicate source and the prefill stay.
describe("the overview's links keep the page's other search parameters", () => {
  const overviewLink = (name: string) => within(main().getByRole('region', { name: t('rt.overview') })).getByRole('link', { name });

  it('on a Duplicate page: the copy stays, no leave question, the tab changes', async () => {
    const { user, admin } = await openEditor('#/routes/~new?from=api-v1', { objects: objects([API_V1]), replies: pluginReplies() });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    const name = main().getByRole('textbox', { name: t('rt.general.name') });
    await user.clear(name);
    await user.type(name, 'api-v1-copy');
    expect(overviewLink(t('rt.tab.matching'))).toHaveAttribute('href', '#/routes/~new?from=api-v1&tab=matching');
    await user.click(overviewLink(t('rt.tab.matching')));
    expect(await main().findByRole('tab', { name: new RegExp(`^${t('rt.tab.matching')}`), selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.hash.split('?')[1]).get('from')).toBe('api-v1');
    // Still the copy, with the name typed.
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('rt.tab.general')}`) }));
    expect(await main().findByRole('textbox', { name: t('rt.general.name') })).toHaveValue('api-v1-copy');
    expect(writesOf(admin)).toEqual([]);
  });

  it('on a prefilled create page: service_id stays in the address', async () => {
    const { user } = await openEditor('#/routes/~new?service_id=web', { objects: objects([]), replies: pluginReplies() });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    expect(overviewLink(t('rt.tab.upstream'))).toHaveAttribute('href', '#/routes/~new?service_id=web&tab=upstream');
    await user.click(overviewLink(t('rt.tab.upstream')));
    expect(await main().findByRole('tab', { name: new RegExp(`^${t('rt.tab.upstream')}`), selected: true })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.hash.split('?')[1]).get('service_id')).toBe('web');
  });
});

describe('the create page copies the prefill params into the new route', () => {
  it('service_id and plugin_config_id; a param the kind does not list is ignored', async () => {
    const { user, admin } = await openEditor('#/routes/new?service_id=web&plugin_config_id=common-headers&name=nope&tab=upstream', { objects: objects([]), replies: pluginReplies() });
    await settled();
    // From a service's "New route" link: the service's upstream.
    expect(main().getByRole('radio', { name: t('rt.up.source.service') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ uri: '/*', status: 1, service_id: 'web', plugin_config_id: 'common-headers' });
  });
});

describe('what the Matching tab shows is what gets saved', () => {
  const saveKeys = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

  it('host text typed without Enter is saved by Cmd/Ctrl-S; a host APISIX refuses blocks Save, naming Hosts', async () => {
    const { user, admin } = await openRoute(API_V1, '#/routes/api-v1?tab=matching');
    await settled();
    await user.keyboard('e');
    const hosts = main().getByRole('textbox', { name: t('rt.match.hosts') });

    await user.type(hosts, 'bad host');
    saveKeys();
    const held = t('ui.pending.tag', { field: t('rt.match.hosts'), text: 'bad host', reason: t('rt.issue.host', { host: 'bad host' }) });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held })));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(t('rt.tab.matching'))).toHaveAccessibleName(`${t('rt.tab.matching')} ${t('ui.tabs.errors', { count: 1 })}`);

    await user.click(tab(t('rt.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(held);
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));

    await user.clear(hosts);
    await user.type(hosts, 'b.apiseven.test');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.hosts).toEqual(['api.apiseven.test', 'b.apiseven.test']);
    expect(writesOf(admin)[0]?.body).not.toHaveProperty('host');
  });

  // Final wave E3: a stored `vars: {}` (an empty list to APISIX) holds nothing and is sent as stored.
  it('a stored `vars: {}` blocks neither Save nor a tab switch, and is sent as stored', async () => {
    const { user, admin } = await openRoute({ ...SHOP, vars: {} }, '#/routes/shop?tab=matching');
    await settled();
    await user.keyboard('e');
    await user.click(tab(t('rt.tab.general')));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.type(await main().findByRole('textbox', { name: t('rt.general.name') }), '-2');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'shop-2', vars: {} });
  });

  it('a URI typed without Enter is saved; one without a leading / blocks Save, naming URIs', async () => {
    const { user, admin } = await openRoute(SHOP, '#/routes/shop?tab=matching');
    await settled();
    await user.keyboard('e');
    const uris = main().getByRole('textbox', { name: `${t('rt.match.uris')} (${t('ui.required')})` });
    await user.type(uris, 'no-slash');
    saveKeys();
    const held = t('ui.pending.tag', { field: t('rt.match.uris'), text: 'no-slash', reason: t('rt.issue.uriSlash', { uri: 'no-slash' }) });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held })));
    expect(writesOf(admin)).toEqual([]);

    await user.clear(uris);
    await user.type(uris, '/shop/*');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.uris).toEqual(['/*', '/shop/*']);
    expect(writesOf(admin)[0]?.body).not.toHaveProperty('uri');
  });

  it('a condition row that holds input blocks Save; fixed, the PUT has exactly the rows shown', async () => {
    const { user, admin } = await openRoute(API_V1, '#/routes/api-v1?tab=matching');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('rt.vars.add') }));
    await user.type(main().getByRole('textbox', { name: t('rt.vars.valueN', { n: 2 }) }), 'ios');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    const held = t('rt.vars.held.noVariable', { n: 2 });
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held }));
    expect(writesOf(admin)).toEqual([]);

    await user.type(main().getByRole('combobox', { name: t('rt.vars.variableN', { n: 2 }) }), 'http_user');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.vars).toEqual([['http_x_tenant', '~~', '^[a-z0-9-]+$'], ['http_user', '==', 'ios']]);
  });

  it('conditions as JSON that does not parse block Save; the JSON tab shows the saved list', async () => {
    const { user, admin } = await openRoute(API_V1, '#/routes/api-v1?tab=matching');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('rt.vars.asJson') }));
    const box = await main().findByRole('textbox', { name: t('rt.vars.json') });
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('[["OR", ["arg_a", "==", "1"]');
    saveKeys();
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: t('rt.vars.held.json') })));
    expect(writesOf(admin)).toEqual([]);

    await user.paste(', ["arg_b", "==", "2"]]]');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.vars).toEqual([['OR', ['arg_a', '==', '1'], ['arg_b', '==', '2']]]);
    await user.click(tab(t('editor.json.tab')));
    expect((await jsonEditor('Route')).textContent).toContain('"OR"');
  });
});

describe('fix round 1', () => {
  it("a source chosen and left empty is gone after Save: the locked view says Service's upstream", async () => {
    const { user, admin } = await openRoute(WEB_HOME, '#/routes/web-home?tab=upstream');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('radio', { name: t('rt.up.source.existing') }));
    expect(main().getByRole('radio', { name: t('rt.up.source.existing') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await screen.findByText(t('editor.locked'));
    expect(writesOf(admin)).toEqual([]);
    const proxy = main().getByText(t('rt.up.source'), { selector: 'label' }).closest('.ui-field');
    expect(proxy).toHaveTextContent(t('rt.up.source.service'));
    expect(main().queryByText(t('rt.up.upstream'), { selector: 'label' })).not.toBeInTheDocument();
  });

  it('a held condition never leaves the draft: discarded on a tab switch, the stored one is back and saved unchanged', async () => {
    const route = { ...API_V1, id: 'cond', name: 'cond', vars: [['arg_a', '==', 'x'], ['arg_n', '>', 2], ['arg_z', '==', 'z']] };
    const { user, admin } = await openRoute(route, '#/routes/cond?tab=matching');
    await settled();
    await user.keyboard('e');
    const value = () => main().getByRole('textbox', { name: t('rt.vars.valueN', { n: 2 }) });
    await user.clear(value());
    await user.type(value(), 'abc');
    await user.click(tab(t('rt.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(t('rt.vars.held.notNumber', { n: 2, text: 'abc' }));
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.discard') }));
    await settled();
    // Not dirty: nothing left the draft.
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    await user.click(tab(t('rt.tab.matching')));
    await settled();
    expect(value()).toHaveValue('2');

    await user.click(tab(t('rt.tab.general')));
    await settled();
    await user.type(main().getByRole('textbox', { name: t('rt.general.desc') }), 'x');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.vars).toEqual(route.vars);
  });

  it('a stored URI APISIX accepts (no leading /) shows as it is, and other changes save', async () => {
    const route = { ...SHOP, uri: 'wiki' };
    const { user, admin } = await openRoute(route, '#/routes/shop?tab=matching');
    await settled();
    expect(within(main().getByRole('group', { name: t('rt.match.uris') })).getByText('wiki')).toBeInTheDocument();
    expect(tab(t('rt.tab.matching'))).toHaveAccessibleName(t('rt.tab.matching'));
    await user.keyboard('e');
    await user.click(tab(t('rt.tab.general')));
    await settled();
    await user.type(main().getByRole('textbox', { name: t('rt.general.desc') }), 'kept');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ uri: 'wiki', desc: 'kept' });
  });

  it('a held label rename never leaves the draft (R8): discarded on a tab switch, saved unchanged; a valid rename saves in place', async () => {
    const { user, admin } = await openRoute(API_V1);
    await settled();
    await user.keyboard('e');
    const key1 = () => main().getByRole('textbox', { name: t('ui.kv.keyN', { n: 1 }) });
    const value1 = () => main().getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) });
    expect(key1()).toHaveValue('team');
    await user.clear(key1());
    await user.click(tab(t('rt.tab.matching')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(t('ui.pending.noKey', { field: t('rt.general.labels'), n: 1 }));
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.discard') }));
    await settled();
    expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    await user.click(tab(t('rt.tab.general')));
    await settled();
    expect(key1()).toHaveValue('team');
    expect(value1()).toHaveValue('core');

    await user.type(main().getByRole('textbox', { name: t('rt.general.desc') }), 'x');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.labels).toEqual({ team: 'core', env: 'dev' });

    await screen.findByText(t('editor.locked'));
    await user.keyboard('e');
    await user.clear(key1());
    await user.type(key1(), 'squad');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    const labels = writesOf(admin)[1]?.body?.labels as Obj;
    expect(labels).toEqual({ squad: 'core', env: 'dev' });
    expect(Object.keys(labels)).toEqual(['squad', 'env']);
  });

  it("labels: key 2 → team, key 1 → squad, leave, Save: the PUT has what the rows show (fix round 2)", async () => {
    const { user, admin } = await openRoute(API_V1);
    await settled();
    await user.keyboard('e');
    const key = (n: number) => main().getByRole('textbox', { name: t('ui.kv.keyN', { n }) });
    expect(key(1)).toHaveValue('team');
    expect(key(2)).toHaveValue('env');
    await user.clear(key(2));
    await user.type(key(2), 'team');
    await user.clear(key(1));
    await user.type(key(1), 'squad');
    await user.click(main().getByRole('heading', { level: 1 }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const labels = writesOf(admin)[0]?.body?.labels as Obj;
    expect(labels).toEqual({ squad: 'core', team: 'dev' });
    expect(Object.keys(labels)).toEqual(['squad', 'team']);
  });
});
