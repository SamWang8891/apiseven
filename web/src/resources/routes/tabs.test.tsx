// The route editor's tabs, each rendered as the frame renders it (controlled by the draft).
import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderRouteTab } from '../../test/routeTab';
import { editableControls } from '../../test/schemaForm';
import { AdvancedTab } from './AdvancedTab';
import { GeneralTab } from './GeneralTab';
import { MatchingTab } from './MatchingTab';
import { RoutePluginsTab } from './PluginsTab';
import { isEmptyUpstream, sourceOf } from '../upstreamSource';
import { UpstreamTab } from './UpstreamTab';

beforeAll(async () => {
  // The inline form and the plugin cards load lazily elsewhere; warm them so the first test isn't slow.
  await import('../../upstream/UpstreamForm');
  await import('../../plugins/PluginsTab');
});

const WEB_POOL = itemOf('u1', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }, { host: '10.0.0.12', port: 8080, weight: 1 }] });
const CTX = ctxOf({
  upstreams: [WEB_POOL, itemOf('u2', { name: 'api-backend', nodes: { 'backend.internal:443': 1 } })],
  services: [itemOf('s1', { name: 'web', upstream_id: 'u1', hosts: ['apiseven.test'], plugins: { gzip: {} } }), itemOf('s2', { name: 'bare' })],
  pluginConfigs: [itemOf('pc1', { name: 'common-headers', plugins: { 'response-rewrite': {} } })],
});

/** Every optional field a route can have. */
const FULL: Obj = {
  id: 'r1',
  name: 'full',
  desc: 'Every field set',
  labels: { team: 'core', env: 'dev' },
  priority: 5,
  hosts: ['a.example', '*.b.example'],
  uris: ['/v1', '/v1/*'],
  methods: ['GET', 'POST'],
  remote_addrs: ['10.0.0.0/8', '::1'],
  vars: [['arg_id', '==', '1'], ['http_x', '!', '~~', '^a']],
  filter_func: 'function(vars) return true end',
  service_id: 's1',
  upstream_id: 'u1',
  plugin_config_id: 'pc1',
  plugins: { 'limit-count': { count: 1, time_window: 60 } },
  timeout: { connect: 3, send: 10, read: 10 },
  enable_websocket: true,
  status: 1,
};

/** The other full route: a script, which APISIX takes only without plugins and a plugin config. */
const SCRIPTED: Obj = {
  ...Object.fromEntries(Object.entries(FULL).filter(([key]) => key !== 'plugins' && key !== 'plugin_config_id')),
  script: 'local _M = {} function _M.access(ctx) end return _M',
  script_id: 'old-dashboard-1',
};

const TABS = [GeneralTab, MatchingTab, UpstreamTab, RoutePluginsTab, AdvancedTab];

describe('every tab renders a full route', () => {
  it.each(TABS.map((tab) => [tab.name, tab] as const))('%s, locked: no form controls', async (_, Tab) => {
    const { container } = renderRouteTab(Tab, FULL, { locked: true, ctx: CTX });
    // Let lazy parts (code editors, plugin cards) settle.
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(editableControls(container)).toEqual([]);
  });

  it.each(TABS.map((tab) => [tab.name, tab] as const))('%s, unlocked', async (_, Tab) => {
    const h = renderRouteTab(Tab, FULL, { ctx: CTX });
    await waitFor(() => expect(h.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(h.changes).not.toHaveBeenCalled();
  });

  it.each(TABS.map((tab) => [tab.name, tab] as const))('%s, with a script instead of plugins, locked and unlocked', async (_, Tab) => {
    const locked = renderRouteTab(Tab, SCRIPTED, { locked: true, ctx: CTX });
    await waitFor(() => expect(locked.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(editableControls(locked.container)).toEqual([]);
    locked.unmount();
    const h = renderRouteTab(Tab, SCRIPTED, { ctx: CTX });
    await waitFor(() => expect(h.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(h.changes).not.toHaveBeenCalled();
  });
});

describe('Matching: hosts and URIs (one value → host/uri, several → hosts/uris)', () => {
  const pairs = [
    { single: 'host', plural: 'hosts', label: () => t('rt.match.hosts'), one: 'a.example', two: 'b.example', base: { uri: '/x' } },
    { single: 'uri', plural: 'uris', label: () => `${t('rt.match.uris')} (${t('ui.required')})`, one: '/a', two: '/b', base: {} },
  ];

  it.each(pairs)('$plural: ["a"] loaded → edits write $single, two values $plural, none neither', async ({ single, plural, label, one, two, base }) => {
    const h = renderRouteTab(MatchingTab, { ...base, upstream_id: 'u1', [plural]: [one] }, { ctx: CTX });
    const box = screen.getByRole('textbox', { name: label() });
    await h.user.type(box, `${two}{Enter}`);
    expect(h.value()[plural]).toEqual([one, two]);
    expect(h.value()).not.toHaveProperty(single);

    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: two }) }));
    expect(h.value()[single]).toBe(one);
    expect(h.value()).not.toHaveProperty(plural);

    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: one }) }));
    expect(h.value()).not.toHaveProperty(single);
    expect(h.value()).not.toHaveProperty(plural);
  });

  it('refuses a host APISIX would refuse, and holds it', async () => {
    const h = renderRouteTab(MatchingTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.type(screen.getByRole('textbox', { name: t('rt.match.hosts') }), 'a b{Enter}');
    expect(h.held()).toEqual([t('ui.pending.tag', { field: t('rt.match.hosts'), text: 'a b', reason: t('rt.issue.host', { host: 'a b' }) })]);
    expect(h.value()).not.toHaveProperty('host');
  });

  it('says what an empty host list means when locked, and shows the service hosts it inherits', () => {
    renderRouteTab(MatchingTab, { uri: '/x', service_id: 's1' }, { locked: true, ctx: CTX });
    const hosts = screen.getByRole('group', { name: t('rt.match.hosts') });
    expect(hosts).toHaveTextContent('apiseven.test');
    expect(hosts).toHaveTextContent(t('rt.match.fromService', { name: 'web' }));
  });
});

describe('Matching: what APISIX accepts shows as it is; stricter checks apply to what is typed', () => {
  it.each([
    ['URIs', { uri: 'wiki' }, `${'URIs'} (${t('ui.required')})`, 'wiki', () => t('rt.issue.uriSlash', { uri: 'wiki' })],
    ['client addresses', { uri: '/x', remote_addr: 'fe80::/200' }, 'Client addresses', 'fe80::/200', () => t('rt.issue.addr', { addr: 'fe80::/200' })],
  ])('%s', async (_, stored, label, typed, reason) => {
    const h = renderRouteTab(MatchingTab, { upstream_id: 'u1', ...stored }, { ctx: CTX });
    // Stored: no issue, shown as a tag.
    expect(screen.queryByText(reason())).not.toBeInTheDocument();
    expect(screen.getByText(typed)).toBeInTheDocument();
    // Typed: refused at entry, held.
    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: typed }) }));
    await h.user.type(screen.getByRole('textbox', { name: label }), `${typed}{Enter}`);
    expect(h.held()).toEqual([t('ui.pending.tag', { field: label.replace(/ \(.*\)$/, ''), text: typed, reason: reason() })]);
  });

  it('a long URI among several is shown and kept; typed, it is refused', async () => {
    const long = `/${'a'.repeat(4096)}`;
    const h = renderRouteTab(MatchingTab, { upstream_id: 'u1', uris: ['/x', long] }, { ctx: CTX });
    expect(screen.queryByText(t('rt.issue.uriLong'))).not.toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: long }) }));
    await h.user.click(screen.getByRole('textbox', { name: `URIs (${t('ui.required')})` }));
    await h.user.paste(long);
    await h.user.keyboard('{Enter}');
    expect(h.held()).toEqual([t('ui.pending.tag', { field: 'URIs', text: long, reason: t('rt.issue.uriLong') })]);
  });
});

describe('locked views while a list is loading say so', () => {
  const loading = ctxOf({ loaded: { services: false, pluginConfigs: false } });

  it('hosts inherited from a service', () => {
    renderRouteTab(MatchingTab, { uri: '/x', service_id: 's1' }, { locked: true, ctx: loading });
    const hosts = screen.getByRole('group', { name: t('rt.match.hosts') });
    expect(hosts).toHaveTextContent(t('picker.loading'));
    expect(hosts).not.toHaveTextContent(t('rt.match.anyHost'));
  });

  it('inherited plugins', () => {
    renderRouteTab(RoutePluginsTab, { uri: '/x', service_id: 's1', plugin_config_id: 'pc1' }, { locked: true, ctx: loading });
    expect(screen.getByText(t('rt.pl.inheritedLoading'))).toBeInTheDocument();
  });

  it('the General overview', () => {
    renderRouteTab(GeneralTab, { uri: '/x', service_id: 's1' }, { locked: true, ctx: loading });
    const overview = screen.getByRole('region', { name: t('rt.overview') });
    expect(overview).not.toHaveTextContent(t('rt.match.anyHost'));
    expect(overview).not.toHaveTextContent(t('rt.overview.noPlugins'));
    expect(overview).not.toHaveTextContent(t('rt.up.resolvesNone'));
    expect(overview.textContent?.split(t('picker.loading')).length).toBeGreaterThanOrEqual(4);
  });
});

describe('Matching: methods', () => {
  const box = (m: string) => screen.getByRole('checkbox', { name: m });

  it('none ticked: methods absent, and "Any method" is said', async () => {
    const h = renderRouteTab(MatchingTab, { uri: '/x', upstream_id: 'u1', methods: ['GET'] }, { ctx: CTX });
    await h.user.click(box('GET'));
    expect(h.value()).not.toHaveProperty('methods');
    expect(screen.getByText(t('rt.match.anyMethod'))).toBeInTheDocument();
  });

  it('ticking two writes them in the schema order; None removes the key; All ticks all ten', async () => {
    const h = renderRouteTab(MatchingTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.click(box('PUT'));
    await h.user.click(box('GET'));
    expect(h.value().methods).toEqual(['GET', 'PUT']);
    await h.user.click(screen.getByRole('button', { name: t('rt.match.none') }));
    expect(h.value()).not.toHaveProperty('methods');
    await h.user.click(screen.getByRole('button', { name: t('rt.match.all') }));
    expect(h.value().methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'PURGE']);
  });

  it('locked: chips, or "Any method"', () => {
    renderRouteTab(MatchingTab, { uri: '/x', methods: ['GET', 'POST'] }, { locked: true, ctx: CTX });
    const methods = screen.getByRole('group', { name: t('rt.match.methods') });
    expect(within(methods).getByText('GET')).toBeInTheDocument();
    expect(within(methods).getByText('POST')).toBeInTheDocument();
  });

  it('locked without methods: "Any method"', () => {
    renderRouteTab(MatchingTab, { uri: '/x' }, { locked: true, ctx: CTX });
    expect(screen.getByRole('group', { name: t('rt.match.methods') })).toHaveTextContent(t('rt.match.anyMethod'));
  });
});

describe('Upstream: where requests go', () => {
  it('derives the source from the draft', () => {
    expect(sourceOf({ service_id: 's1' })).toBe('service');
    expect(sourceOf({ upstream_id: 'u1' })).toBe('existing');
    expect(sourceOf({ upstream: { nodes: [] } })).toBe('inline');
    expect(sourceOf({ upstream_id: 'u1', upstream: { nodes: [] } })).toBe('existing');
    expect(sourceOf({ service_id: 's1', upstream: { nodes: [] } })).toBe('inline');
    expect(sourceOf({})).toBe('none');
  });

  it('an empty inline upstream is one without nodes or settings', () => {
    expect(isEmptyUpstream(undefined)).toBe(true);
    expect(isEmptyUpstream({ type: 'roundrobin', nodes: [] })).toBe(true);
    expect(isEmptyUpstream({ nodes: {} })).toBe(true);
    expect(isEmptyUpstream({ nodes: [{ host: 'h' }] })).toBe(false);
    expect(isEmptyUpstream({ type: 'chash' })).toBe(false);
  });

  const radio = (key: string) => screen.getByRole('radio', { name: t(`rt.up.source.${key}`) });

  it('a new route starts on Inline, with the node table ready', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/*', status: 1 }, { isNew: true, ctx: CTX });
    expect(radio('inline')).toBeChecked();
    expect(radio('service')).toHaveAttribute('aria-disabled', 'true');
    // Without a service, a click on "Service's upstream" chooses nothing (fix round 1, R4.5).
    await h.user.click(radio('service'));
    expect(radio('inline')).toBeChecked();
    expect(radio('service')).not.toBeChecked();
    expect(h.value()).toEqual({ uri: '/*', status: 1 });
    expect(await screen.findByRole('textbox', { name: t('up.nodes.new') })).toBeInTheDocument();
  });

  it('Inline → Existing asks before discarding a non-empty upstream, then removes it; picking sets upstream_id', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } }, { ctx: CTX });
    await h.user.click(radio('existing'));
    const dialog = await screen.findByRole('alertdialog', { name: t('rt.up.discard.title') });
    await h.user.click(within(dialog).getByRole('button', { name: t('rt.up.discard.confirm') }));
    expect(h.value()).not.toHaveProperty('upstream');
    expect(radio('existing')).toBeChecked();

    await h.user.click(screen.getByRole('combobox', { name: t('rt.up.upstream') }));
    await h.user.click(await screen.findByRole('option', { name: /web-pool/ }));
    expect(h.value()).toEqual({ uri: '/x', upstream_id: 'u1' });
  });

  it('keeping the inline upstream leaves everything as it was', async () => {
    const draft = { uri: '/x', upstream: { nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
    const h = renderRouteTab(UpstreamTab, draft, { ctx: CTX });
    await h.user.click(radio('existing'));
    await h.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('rt.up.discard.cancel') }));
    expect(h.changes).not.toHaveBeenCalled();
    expect(radio('inline')).toBeChecked();
  });

  it("Existing → Service's upstream removes upstream_id; → Inline from Service removes nothing yet", async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1', upstream_id: 'u2' }, { ctx: CTX });
    expect(radio('existing')).toBeChecked();
    await h.user.click(radio('service'));
    expect(h.value()).toEqual({ uri: '/x', service_id: 's1' });
    await h.user.click(radio('inline'));
    expect(radio('inline')).toBeChecked();
    expect(h.value()).toEqual({ uri: '/x', service_id: 's1' });
  });

  it("Existing with a leftover inline upstream: the note offers to remove it", async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', upstream_id: 'u1', upstream: { nodes: [{ host: 'h', port: 1, weight: 1 }] } }, { ctx: CTX });
    await h.user.click(screen.getByRole('button', { name: t('rt.up.removeInline') }));
    expect(h.value()).toEqual({ uri: '/x', upstream_id: 'u1' });
  });

  it('"Resolves to" shows the service\'s upstream when the route inherits it', () => {
    renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1' }, { locked: true, ctx: CTX });
    const line = screen.getByRole('group', { name: t('rt.up.resolves') });
    expect(line).toHaveTextContent('web-pool');
    expect(line).toHaveTextContent(t('rt.up.viaService', { name: 'web' }));
    expect(line).toHaveTextContent('10.0.0.11:8080');
    expect(line).toHaveTextContent('10.0.0.12:8080');
  });

  it('leaving Inline asks while the inline form holds input, though nothing of it is in the draft yet', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/*', status: 1 }, { isNew: true, ctx: CTX });
    await h.user.click(await screen.findByRole('button', { name: t('up.section.connection') }));
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.conn.retries') }), 'abc');
    expect(h.held()).toHaveLength(1);
    expect(h.value()).not.toHaveProperty('upstream');
    await h.user.click(radio('existing'));
    const dialog = await screen.findByRole('alertdialog', { name: t('rt.up.discard.title') });
    expect(dialog).toHaveTextContent(t('rt.up.discard.bodyHeld'));
    await h.user.click(within(dialog).getByRole('button', { name: t('rt.up.discard.cancel') }));
    expect(radio('inline')).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: t('up.conn.retries') })).toHaveValue('abc');
  });

  it('Existing → Inline removes upstream_id, without asking', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.click(radio('inline'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(radio('inline')).toBeChecked();
    expect(h.value()).toEqual({ uri: '/x' });
  });

  it("Inline → Service's upstream asks before discarding the inline upstream, then removes it", async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1', upstream: { nodes: [{ host: 'h', port: 1, weight: 1 }] } }, { ctx: CTX });
    await h.user.click(radio('service'));
    const dialog = await screen.findByRole('alertdialog', { name: t('rt.up.discard.title') });
    expect(h.changes).not.toHaveBeenCalled();
    await h.user.click(within(dialog).getByRole('button', { name: t('rt.up.discard.confirm') }));
    expect(h.value()).toEqual({ uri: '/x', service_id: 's1' });
  });

  it("Existing → Service's upstream asks too when a leftover inline upstream would go with it", async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1', upstream_id: 'u1', upstream: { nodes: [{ host: 'h', port: 1, weight: 1 }] } }, { ctx: CTX });
    expect(radio('existing')).toBeChecked();
    await h.user.click(radio('service'));
    const dialog = await screen.findByRole('alertdialog', { name: t('rt.up.discard.title') });
    expect(h.changes).not.toHaveBeenCalled();
    await h.user.click(within(dialog).getByRole('button', { name: t('rt.up.discard.confirm') }));
    expect(h.value()).toEqual({ uri: '/x', service_id: 's1' });
  });

  it('a source chosen but not filled in is forgotten when the editor locks: the locked view says what the draft does', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1' }, { ctx: CTX });
    await h.user.click(radio('existing'));
    expect(radio('existing')).toBeChecked();
    h.lock(true);
    const proxy = screen.getByText(t('rt.up.source'), { selector: 'label' }).closest('.ui-field');
    expect(proxy).toHaveTextContent(t('rt.up.source.service'));
    expect(screen.queryByText(t('rt.up.upstream'))).not.toBeInTheDocument();
    h.lock(false);
    expect(radio('service')).toBeChecked();
  });

  it('the service picker removes service_id when cleared', async () => {
    const h = renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.click(screen.getAllByRole('button', { name: t('ui.select.clear') })[0] as HTMLElement);
    expect(h.value()).toEqual({ uri: '/x', upstream_id: 'u1' });
  });

  it('a dangling upstream id reads "loading" while upstreams load, not "not found"', () => {
    renderRouteTab(UpstreamTab, { uri: '/x', upstream_id: 'u9' }, { locked: true, ctx: ctxOf({ loaded: { upstreams: false } }) });
    expect(screen.getAllByText(t('picker.loading'))).toHaveLength(2);
    expect(screen.queryByText(t('picker.notFound', { id: 'u9' }))).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).not.toHaveTextContent(t('rt.issue.missing.upstream', { id: 'u9' }));
  });

  it('a service route resolves to the upstream it inherits, named, not to the service', () => {
    renderRouteTab(UpstreamTab, { uri: '/x', service_id: 's1' }, { locked: true, ctx: CTX });
    const line = screen.getByRole('group', { name: t('rt.up.resolves') });
    expect(line).toHaveTextContent(`web-pool${t('rt.up.viaService', { name: 'web' })}`);
  });
});

describe('Plugins', () => {
  it('a plugin config picker above the cards, and the inherited plugins listed', async () => {
    const h = renderRouteTab(RoutePluginsTab, { uri: '/x', service_id: 's1', plugin_config_id: 'pc1' }, { ctx: CTX });
    expect(screen.getByRole('combobox', { name: t('rt.pl.config') })).toHaveTextContent('common-headers');
    expect(await screen.findByText(t('pl.inherited.title'))).toBeInTheDocument();
    expect(screen.getByText('gzip')).toBeInTheDocument();
    expect(screen.getByText('response-rewrite')).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: t('ui.select.clear') }));
    expect(h.value()).toEqual({ uri: '/x', service_id: 's1' });
  });

  it('a route with a script says no plugins run', () => {
    renderRouteTab(RoutePluginsTab, { uri: '/x', script: 'return {}  -- x' }, { ctx: CTX });
    expect(screen.getByText(t('rt.pl.scriptNote'))).toBeInTheDocument();
  });
});

describe('Advanced', () => {
  it('one timeout writes all three; clearing all three removes timeout', async () => {
    const h = renderRouteTab(AdvancedTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.type(screen.getByRole('spinbutton', { name: t('rt.adv.connect') }), '3');
    expect(h.value().timeout).toEqual({ connect: 3, send: 60, read: 60 });
    for (const key of ['connect', 'send', 'read']) await h.user.clear(screen.getByRole('spinbutton', { name: t(`rt.adv.${key}`) }));
    expect(h.value()).not.toHaveProperty('timeout');
  });

  it('WebSocket: default, on and off', async () => {
    const h = renderRouteTab(AdvancedTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    expect(screen.getByRole('radio', { name: t('rt.adv.ws.default') })).toBeChecked();
    await h.user.click(screen.getByRole('radio', { name: t('rt.adv.ws.on') }));
    expect(h.value().enable_websocket).toBe(true);
    await h.user.click(screen.getByRole('radio', { name: t('rt.adv.ws.off') }));
    expect(h.value().enable_websocket).toBe(false);
    await h.user.click(screen.getByRole('radio', { name: t('rt.adv.ws.default') }));
    expect(h.value()).not.toHaveProperty('enable_websocket');
  });

  it("a route with a service: unset WebSocket is the service's setting", () => {
    renderRouteTab(AdvancedTab, { uri: '/x', service_id: 's1' }, { ctx: CTX });
    expect(screen.getByRole('radio', { name: t('rt.adv.ws.service') })).toBeChecked();
  });

  it('locked without timeouts says the upstream ones apply', () => {
    renderRouteTab(AdvancedTab, { uri: '/x', upstream_id: 'u1' }, { locked: true, ctx: CTX });
    expect(screen.getByText(t('rt.adv.timeoutsUnset'))).toBeInTheDocument();
  });

  it('the script section says plugins stop running', async () => {
    const h = renderRouteTab(AdvancedTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.click(screen.getByRole('button', { name: t('rt.adv.script') }));
    expect(screen.getByText(t('rt.adv.scriptHelp'))).toBeInTheDocument();
  });
});

describe('General', () => {
  it('edits name, description, labels and priority', async () => {
    const h = renderRouteTab(GeneralTab, { uri: '/x', upstream_id: 'u1' }, { ctx: CTX });
    await h.user.type(screen.getByRole('textbox', { name: t('rt.general.name') }), 'shop');
    await h.user.type(screen.getByRole('spinbutton', { name: t('rt.general.priority') }), '10');
    expect(h.value()).toEqual({ uri: '/x', upstream_id: 'u1', name: 'shop', priority: 10 });
  });

  it('locked, an overview links to each tab', () => {
    renderRouteTab(GeneralTab, FULL, { locked: true, ctx: CTX });
    const overview = screen.getByRole('region', { name: t('rt.overview') });
    for (const tab of ['matching', 'upstream', 'plugins', 'advanced']) {
      expect(within(overview).getByRole('link', { name: t(tab === 'plugins' ? 'pl.tab' : `rt.tab.${tab}`) })).toHaveAttribute('href', `/?tab=${tab}`);
    }
    expect(overview).toHaveTextContent('a.example');
    expect(overview).toHaveTextContent('web-pool');
  });

  it('a partial timeout reads as what is set, and what is not', () => {
    renderRouteTab(GeneralTab, { uri: '/x', upstream_id: 'u1', timeout: { connect: 3 } }, { locked: true, ctx: CTX });
    const overview = screen.getByRole('region', { name: t('rt.overview') });
    expect(overview).not.toHaveTextContent('undefined');
    expect(overview).toHaveTextContent(
      t('rt.overview.timeouts', {
        list: [
          t('rt.overview.timeout', { name: t('rt.overview.t.connect'), value: 3 }),
          t('rt.overview.timeoutMissing', { name: t('rt.overview.t.send') }),
          t('rt.overview.timeoutMissing', { name: t('rt.overview.t.read') }),
        ].join(', '),
      }),
    );
  });
});
