// Every kind, every tab (consumers, certificates and the rest): each editor tab opens locked, and a
// change to one field it owns is saved with every other stored field deep-equal to before. See
// tabKinds.ts.
import { EC_PAIR, RSA_PAIR } from '../src/test/pairs';
import { Admin, expect, setCode, t, test } from './fixtures';
import { KEPT, PREFIX, desc, kind, pluginField } from './tabKinds';

test.afterAll(async () => {
  const admin = new Admin();
  await admin.removePrefixed(PREFIX);
  await admin.del('plugin_metadata/http-logger');
});

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
