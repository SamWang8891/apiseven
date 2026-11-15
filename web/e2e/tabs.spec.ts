// Every kind, every tab: each editor tab opens locked, and a change to one field it owns is saved
// with every other stored field deep-equal to before. Each object carries an unknown key `x_e2e`
// where APISIX keeps one: inside a plugin's config and an upstream node (every kind's top level
// refuses unknown keys, except secrets and plugin metadata; SSLs and protos take none anywhere).
// Tabs that own no field (a service's Routes, a consumer's Credentials, a group's Consumers, a plugin
// config's Used by) are covered by lock.spec.ts.
import { EC_PAIR, RSA_PAIR } from '../src/test/pairs';
import {
  Admin,
  ECHO,
  changeOnTab,
  choose,
  echoUpstream,
  expect,
  openCard,
  setCode,
  t,
  test,
  type Json,
  type TabChange,
} from './fixtures';

const PREFIX = 'e2e-tabs-';
const KEPT = 'kept';
const node = (extra: Json = {}) => ({ host: ECHO.host, port: ECHO.port, weight: 1, x_e2e: KEPT, ...extra });

test.afterAll(async () => {
  const admin = new Admin();
  await admin.removePrefixed(PREFIX);
  await admin.del('plugin_metadata/http-logger');
});

const desc = (tab: string, label: string): TabChange => ({
  tab,
  field: 'desc',
  value: () => `changed on ${tab}`,
  change: async (panel) => {
    await panel.getByRole('textbox', { name: label, exact: true }).fill(`changed on ${tab}`);
  },
});

/** A plugin card's field, typed or numeric: the form shows numbers that also take text as textboxes. */
async function pluginField(page: import('@playwright/test').Page, plugin: string, field: string, value: string) {
  const card = await openCard(page, plugin);
  const name = new RegExp(`^${field}\\b`);
  await card.getByRole('spinbutton', { name }).or(card.getByRole('textbox', { name })).first().fill(value);
}

const nodeWeight = (tab: string, field = 'upstream'): TabChange => ({
  tab,
  field,
  value: (before) => {
    const up = before[field] as Json;
    return { ...up, nodes: [{ ...(up.nodes as Json[])[0], weight: 5 }] };
  },
  change: async (panel) => {
    await panel.getByRole('spinbutton', { name: t('up.nodes.weightN', { n: 1 }) }).fill('5');
  },
});

function kind(name: string, setup: { editor: string; api: string; create: (admin: Admin) => Promise<void> }, changes: TabChange[]) {
  test.describe(name, () => {
    test.beforeAll(async () => {
      await setup.create(new Admin());
    });
    for (const change of changes) {
      test(`${name}, ${change.tab} tab: a change to ${change.field} is saved, and nothing else changes`, async ({ page, admin }) => {
        await changeOnTab(page, admin, setup.editor, setup.api, change);
      });
    }
  });
}

const route = `${PREFIX}route`;
kind(
  'routes',
  {
    editor: `routes/${route}`,
    api: `routes/${route}`,
    create: (a) =>
      a.put(`routes/${route}`, {
        name: route,
        host: `${route}.e2e.test`,
        uri: ECHO.path,
        labels: { team: 'e2e' },
        plugins: { gzip: { comp_level: 5, x_e2e: KEPT } },
        upstream: { type: 'roundrobin', nodes: [node()] },
      }).then(() => undefined),
  },
  [
    desc(t('rt.tab.general'), t('rt.general.desc')),
    {
      tab: t('rt.tab.matching'),
      field: 'methods',
      value: () => ['GET'],
      change: (panel) => panel.getByRole('checkbox', { name: 'GET', exact: true }).click(),
    },
    nodeWeight(t('rt.tab.upstream')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ gzip: { comp_level: 3, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'gzip', 'comp_level', '3'),
    },
    {
      tab: t('rt.tab.advanced'),
      field: 'enable_websocket',
      value: () => true,
      change: (panel) => panel.getByRole('radio', { name: t('ui.on'), exact: true }).click(),
    },
  ],
);

const upstream = `${PREFIX}upstream`;
kind(
  'upstreams',
  {
    editor: `upstreams/${upstream}`,
    api: `upstreams/${upstream}`,
    create: (a) => a.put(`upstreams/${upstream}`, { name: upstream, type: 'roundrobin', nodes: [node()], retries: 1 }).then(() => undefined),
  },
  [
    desc(t('up.tab.general'), t('up.general.desc')),
    {
      tab: t('up.section.nodes'),
      field: 'nodes',
      value: (before) => [{ ...(before.nodes as Json[])[0], weight: 5 }],
      change: (panel) => panel.getByRole('spinbutton', { name: t('up.nodes.weightN', { n: 1 }) }).fill('5'),
    },
    {
      tab: t('up.section.balancing'),
      field: 'type',
      value: () => 'least_conn',
      change: (panel, page) => choose(page, panel.getByRole('combobox', { name: t('up.balance.type') }), t('up.balance.least_conn')),
    },
    {
      tab: t('up.section.health'),
      field: 'checks',
      value: () => expect.objectContaining({ active: expect.any(Object) }),
      change: (panel) => panel.getByRole('switch', { name: t('up.hc.active') }).click(),
    },
    {
      tab: t('up.section.connection'),
      field: 'retries',
      value: () => 3,
      change: (panel) => panel.getByRole('spinbutton', { name: t('up.conn.retries') }).fill('3'),
    },
    {
      tab: t('up.section.tls'),
      field: 'tls',
      value: () => ({ verify: false }),
      change: (panel, page) => choose(page, panel.getByRole('combobox', { name: t('up.tls.verify') }), t('up.tls.verifyOff')),
    },
  ],
);

const service = `${PREFIX}service`;
kind(
  'services',
  {
    editor: `services/${service}`,
    api: `services/${service}`,
    create: async (a) => {
      await a.put(`upstreams/${PREFIX}svc-a`, { name: `${PREFIX}svc-a`, ...echoUpstream() });
      await a.put(`upstreams/${PREFIX}svc-b`, { name: `${PREFIX}svc-b`, ...echoUpstream() });
      await a.put(`services/${service}`, { name: service, upstream_id: `${PREFIX}svc-a`, plugins: { gzip: { comp_level: 5, x_e2e: KEPT } } });
    },
  },
  [
    desc(t('svc.tab.general'), t('svc.general.desc')),
    {
      tab: t('rt.tab.upstream'),
      field: 'upstream_id',
      value: () => `${PREFIX}svc-b`,
      change: (panel, page) => choose(page, panel.getByRole('combobox', { name: t('rt.up.upstream') }), new RegExp(`^${PREFIX}svc-b`)),
    },
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ gzip: { comp_level: 3, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'gzip', 'comp_level', '3'),
    },
  ],
);

const stream = `${PREFIX}stream`;
kind(
  'stream routes',
  {
    editor: `stream_routes/${stream}`,
    api: `stream_routes/${stream}`,
    // A documentation address as the client: it never takes the dev stack's stream traffic.
    create: (a) =>
      a.put(`stream_routes/${stream}`, {
        name: stream,
        remote_addr: '192.0.2.30',
        server_port: 9100,
        plugins: { 'limit-conn': { conn: 100, burst: 50, default_conn_delay: 0.1, key: 'remote_addr', x_e2e: KEPT } },
        upstream: { type: 'roundrobin', nodes: [node()] },
      }).then(() => undefined),
  },
  [
    desc(t('sr.tab.general'), t('sr.general.desc')),
    {
      tab: t('sr.tab.matching'),
      field: 'remote_addr',
      value: () => '192.0.2.31',
      change: (panel) => panel.getByRole('textbox', { name: t('sr.match.remoteAddr') }).fill('192.0.2.31'),
    },
    nodeWeight(t('rt.tab.upstream')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ 'limit-conn': { conn: 100, burst: 60, default_conn_delay: 0.1, key: 'remote_addr', x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'limit-conn', 'burst', '60'),
    },
    {
      tab: t('sr.tab.advanced'),
      field: 'tls_passthrough',
      value: () => true,
      change: (panel) => panel.getByRole('switch', { name: t('sr.adv.passthrough') }).click(),
    },
  ],
);

const username = `${PREFIX}consumer`.replace(/-/g, '_');
kind(
  'consumers',
  {
    editor: `consumers/${username}`,
    api: `consumers/${username}`,
    create: (a) => a.put('consumers', { username, desc: 'stored', plugins: { 'limit-count': { count: 5, time_window: 60, x_e2e: KEPT } } }).then(() => undefined),
  },
  [
    desc(t('cs.tab.general'), t('cs.general.desc')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ 'limit-count': { count: 6, time_window: 60, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'limit-count', 'count', '6'),
    },
  ],
);

const owner = `${PREFIX}owner`.replace(/-/g, '_');
const credential = `${PREFIX}credential`;
kind(
  'credentials',
  {
    editor: `consumers/${owner}/credentials/${credential}`,
    api: `consumers/${owner}/credentials/${credential}`,
    create: async (a) => {
      await a.put('consumers', { username: owner });
      await a.put(`consumers/${owner}/credentials/${credential}`, { name: credential, plugins: { 'key-auth': { key: `${PREFIX}key-1`, x_e2e: KEPT } } });
    },
  },
  [
    desc(t('cr.tab.general'), t('cr.general.desc')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ 'key-auth': { key: `${PREFIX}key-2`, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'key-auth', 'key(?!-)', `${PREFIX}key-2`),
    },
  ],
);

const group = `${PREFIX}group`;
kind(
  'consumer groups',
  {
    editor: `consumer_groups/${group}`,
    api: `consumer_groups/${group}`,
    create: (a) => a.put(`consumer_groups/${group}`, { name: group, plugins: { 'limit-count': { count: 5, time_window: 60, x_e2e: KEPT } } }).then(() => undefined),
  },
  [
    desc(t('cg.tab.general'), t('cg.general.desc')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ 'limit-count': { count: 6, time_window: 60, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'limit-count', 'count', '6'),
    },
  ],
);

const ssl = `${PREFIX}ssl`;
kind(
  'SSL certificates',
  {
    editor: `ssls/${ssl}`,
    api: `ssls/${ssl}`,
    create: (a) => a.put(`ssls/${ssl}`, { type: 'server', snis: ['rotated.apiseven.test'], cert: EC_PAIR.cert, key: EC_PAIR.key }).then(() => undefined),
  },
  [
    {
      tab: t('ssl.tab.certificate'),
      field: 'cert',
      value: () => RSA_PAIR.cert,
      change: async (_panel, page) => {
        await page.getByRole('main').getByRole('button', { name: t('ssl.replace') }).click();
        const dialog = page.getByRole('dialog', { name: t('ssl.replace') });
        await dialog.getByRole('textbox', { name: t('ssl.pem.cert') }).fill(RSA_PAIR.cert);
        await dialog.getByRole('textbox', { name: t('ssl.pem.key') }).fill(RSA_PAIR.key);
        await dialog.getByRole('button', { name: t('ssl.replace.apply') }).click();
        await expect(dialog).toBeHidden();
      },
    },
    {
      tab: t('ssl.tab.snis'),
      field: 'snis',
      value: (before) => [...(before.snis as string[]), 'tabs.e2e.test'],
      change: async (panel) => {
        const box = panel.getByRole('textbox', { name: t('ssl.snis.label') });
        await box.fill('tabs.e2e.test');
        await box.press('Enter');
      },
    },
    {
      tab: t('ssl.tab.client'),
      field: 'client',
      value: () => ({ ca: EC_PAIR.cert }),
      change: async (panel) => {
        await panel.getByRole('switch', { name: t('ssl.client.enable') }).click();
        await panel.getByRole('textbox', { name: t('ssl.client.ca') }).fill(EC_PAIR.cert);
      },
    },
    desc(t('ssl.tab.general'), t('ssl.general.desc')),
  ],
);

const globalRule = `${PREFIX}global`;
kind(
  'global rules',
  {
    editor: `global_rules/${globalRule}`,
    api: `global_rules/${globalRule}`,
    create: (a) => a.put(`global_rules/${globalRule}`, { plugins: { cors: { allow_origins: 'https://e2e-tabs.test', x_e2e: KEPT } } }).then(() => undefined),
  },
  [
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ cors: { allow_origins: 'https://e2e-tabs-2.test', x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'cors', 'allow_origins', 'https://e2e-tabs-2.test'),
    },
  ],
);

const pluginConfig = `${PREFIX}pc`;
kind(
  'plugin configs',
  {
    editor: `plugin_configs/${pluginConfig}`,
    api: `plugin_configs/${pluginConfig}`,
    create: (a) => a.put(`plugin_configs/${pluginConfig}`, { name: pluginConfig, plugins: { gzip: { comp_level: 5, x_e2e: KEPT } } }).then(() => undefined),
  },
  [
    desc(t('pc.tab.general'), t('pc.general.desc')),
    {
      tab: t('pl.tab'),
      field: 'plugins',
      value: () => ({ gzip: { comp_level: 3, x_e2e: KEPT } }),
      change: (_panel, page) => pluginField(page, 'gzip', 'comp_level', '3'),
    },
  ],
);

kind(
  'plugin metadata',
  {
    editor: 'plugin_metadata/http-logger',
    api: 'plugin_metadata/http-logger',
    create: (a) => a.put('plugin_metadata/http-logger', { log_format: { host: '$host' }, x_e2e: KEPT }).then(() => undefined),
  },
  [
    {
      tab: t('pm.tab.config'),
      field: 'max_pending_entries',
      value: () => 100,
      change: (panel) => panel.getByRole('spinbutton', { name: 'max_pending_entries' }).fill('100'),
    },
  ],
);

const proto = `${PREFIX}proto`;
const PROTO = 'syntax = "proto3";\npackage e2e;\nmessage Ping { string id = 1; }\n';
kind(
  'protos',
  {
    editor: `protos/${proto}`,
    api: `protos/${proto}`,
    create: (a) => a.put(`protos/${proto}`, { name: proto, content: PROTO }).then(() => undefined),
  },
  [
    desc(t('pr.tab.general'), t('pr.general.desc')),
    {
      tab: t('pr.tab.content'),
      field: 'content',
      value: () => PROTO.replace('Ping', 'Pong'),
      change: (panel, page) => setCode(page, panel.getByRole('textbox', { name: t('pr.content.label') }), PROTO.replace('Ping', 'Pong')),
    },
  ],
);

const secret = `vault/${PREFIX}secret`;
kind(
  'secrets',
  {
    editor: `secrets/${secret.replace('/', '%2F')}`,
    api: `secrets/${secret}`,
    create: (a) => a.put(`secrets/${secret}`, { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'e2e-vault-token', x_e2e: KEPT }).then(() => undefined),
  },
  [
    {
      tab: t('sc.tab.config'),
      field: 'uri',
      value: () => 'http://127.0.0.1:8201',
      change: (panel) => panel.getByRole('textbox', { name: /^uri\b/ }).fill('http://127.0.0.1:8201'),
    },
  ],
);

