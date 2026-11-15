// Every kind, every tab (the traffic kinds): each editor tab opens locked, and a change to one field it
// owns is saved with every other stored field deep-equal to before. See tabKinds.ts.
import { Admin, ECHO, choose, echoUpstream, expect, t, test, type Json } from './fixtures';
import { KEPT, PREFIX, desc, kind, node, nodeWeight, pluginField } from './tabKinds';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

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
      change: (panel, page) => choose(page, panel.getByRole('combobox', { name: t('rt.up.upstream') }), `${PREFIX}svc-b`),
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
