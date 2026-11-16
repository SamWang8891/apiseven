// Global rules, plugin configs, plugin metadata, protos, secrets and stream routes: each created in its
// form, listed, edited and deleted, with what APISIX does with it checked where it shows.
import { connect } from 'node:net';
import {
  Admin,
  ECHO,
  addPlugin,
  choose,
  create,
  deleteFromEditor,
  env,
  eventually,
  expect,
  expectNotFound,
  expectNotInPage,
  expectSameQuietly,
  gateway,
  gatewayAnswers,
  idField,
  listShows,
  nextWrite,
  openCard,
  openEditor,
  openList,
  openNew,
  openTab,
  save,
  setCode,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-misc-';

test.afterAll(async () => {
  const admin = new Admin();
  await admin.removePrefixed(PREFIX);
  await admin.del('plugin_metadata/http-logger');
});

/** Edit → change the description → Save → the Admin API has it. */
async function editDescription(page: import('@playwright/test').Page, admin: Admin, editor: string, api: string, label: string) {
  await openEditor(page, editor);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: label, exact: true }).fill('edited in the form');
  await save(page);
  expect((await admin.value(api))?.desc).toBe('edited in the form');
}

test.describe('global rules', () => {
  test('created in the form with cors, it answers every route’s requests; edited; deleted, it stops', async ({ page, admin }) => {
    const id = `${PREFIX}gr-${uid()}`;
    const origin = `https://${id}.test`;
    await openNew(page, 'global_rules/~new');
    await idField(page).fill(id);
    const cors = await addPlugin(page, 'cors');
    await cors.getByRole('textbox', { name: /^allow_origins\b/ }).fill(origin);
    await create(page);
    expect(await admin.value(`global_rules/${id}`)).toEqual({ id, plugins: { cors: { allow_origins: origin } } });
    await listShows(page, 'global_rules', id);
    // The seed's healthz route has no cors of its own: the global rule answers for it.
    const withCors = await eventually(
      () => gateway('/healthz', { headers: { Origin: origin } }),
      (r) => r.headers['access-control-allow-origin'] === origin,
    );
    expect(withCors.headers['access-control-allow-origin']).toBe(origin);

    await openEditor(page, `global_rules/${id}`);
    await unlock(page);
    const card = await openCard(page, 'cors');
    await card.getByRole('textbox', { name: /^allow_origins\b/ }).fill(`${origin}:8443`);
    await save(page);
    expect(await admin.value(`global_rules/${id}`)).toEqual({ id, plugins: { cors: { allow_origins: `${origin}:8443` } } });
    // The gateway has the edit before the delete, so "it stops" below cannot be the edit not yet seen.
    const edited = await eventually(
      () => gateway('/healthz', { headers: { Origin: `${origin}:8443` } }),
      (r) => r.headers['access-control-allow-origin'] === `${origin}:8443`,
    );
    expect(edited.headers['access-control-allow-origin']).toBe(`${origin}:8443`);

    await deleteFromEditor(page, t('kind.global_rules.singular'));
    expect(await admin.value(`global_rules/${id}`)).toBeUndefined();
    await listShows(page, 'global_rules', id, false);
    const without = await eventually(
      () => gateway('/healthz', { headers: { Origin: `${origin}:8443` } }),
      (r) => r.headers['access-control-allow-origin'] === undefined,
    );
    expect(without.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('the seed’s global rule adds X-Request-Id to every answer; renamed in the form, the gateway sends the new header', async ({ page, admin }) => {
    const original = await admin.must('global_rules/default');
    try {
      expect((await gateway('/healthz')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const main = await openEditor(page, 'global_rules/default');
      await expect(main.getByRole('tabpanel')).toContainText('request-id');
      await unlock(page);
      const card = await openCard(page, 'request-id');
      await card.getByRole('textbox', { name: /^header_name\b/ }).fill('X-E2E-Request-Id');
      await save(page);
      const renamed = await eventually(
        () => gateway('/healthz'),
        (r) => r.headers['x-e2e-request-id'] !== undefined,
      );
      expect(renamed.headers['x-e2e-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(renamed.headers['x-request-id']).toBeUndefined();
    } finally {
      await admin.put('global_rules/default', { plugins: original.plugins });
    }
    expect(await admin.value('global_rules/default')).toEqual(original);
  });
});

test.describe('plugin configs', () => {
  test('created in the form, a route made from its Used by tab runs its plugin at the gateway; edited; deleted', async ({ page, admin }) => {
    const id = `${PREFIX}pc-${uid()}`;
    const main = await openNew(page, 'plugin_configs/~new');
    await idField(page).fill(id);
    await main.getByRole('textbox', { name: t('pc.general.name') }).fill(id);
    await openTab(page, t('pl.tab'));
    const mocking = await addPlugin(page, 'mocking');
    await mocking.getByRole('textbox', { name: /^response_example\b/ }).fill('{"from":"plugin config"}');
    await create(page);
    expect(await admin.value(`plugin_configs/${id}`)).toEqual({ id, name: id, plugins: { mocking: { response_example: '{"from":"plugin config"}' } } });
    await listShows(page, 'plugin_configs', id);

    await openEditor(page, `plugin_configs/${id}?tab=used_by`);
    await page.getByRole('main').getByRole('link', { name: t('pc.usedBy.new') }).first().click();
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t('page.new', { kind: t('kind.routes.singular') }) })).toBeVisible();
    const route = `${PREFIX}pc-route-${uid()}`;
    const host = `${route}.e2e.test`;
    await idField(page).fill(route);
    const matching = await openTab(page, t('rt.tab.matching'));
    const hosts = matching.getByRole('textbox', { name: t('rt.match.hosts') });
    await hosts.fill(host);
    await hosts.press('Enter');
    // APISIX's schema wants plugins or an upstream on the route itself; a plugin config alone is refused.
    const upstream = await openTab(page, t('rt.tab.upstream'));
    await upstream.getByRole('textbox', { name: t('up.nodes.new') }).fill(ECHO.host);
    await create(page);
    expect((await admin.value(`routes/${route}`))?.plugin_config_id).toBe(id);
    const reply = await gatewayAnswers(host, 200, { path: '/anything' });
    expect(reply.text).toBe('{"from":"plugin config"}');

    await editDescription(page, admin, `plugin_configs/${id}`, `plugin_configs/${id}`, t('pc.general.desc'));
    await admin.del(`routes/${route}`);
    await deleteFromEditor(page, t('kind.plugin_configs.singular'));
    expect(await admin.value(`plugin_configs/${id}`)).toBeUndefined();
    await listShows(page, 'plugin_configs', id, false);
  });
});

test.describe('plugin metadata', () => {
  test('set from the list (Not set → Configured), edited, then Reset back to Not set', async ({ page, admin }) => {
    await admin.del('plugin_metadata/http-logger');
    // Not set: its editor reads it, and APISIX answers 404 (the create-when-missing form follows).
    expectNotFound(page, 'plugin_metadata/http-logger');
    const row = (main: import('@playwright/test').Locator) => main.getByRole('row').filter({ has: page.getByRole('link', { name: 'http-logger', exact: true }) });
    const main = await openList(page, 'plugin_metadata');
    await expect(row(main)).toContainText(t('pm.state.notSet'));
    await row(main).getByRole('link', { name: 'http-logger', exact: true }).click();
    await expect(main.getByText(t('pm.config.notSet', { name: 'http-logger' }))).toBeVisible();
    await main.getByRole('spinbutton', { name: 'max_pending_entries' }).fill('500');
    const write = await create(page);
    expect(write.method).toBe('PUT');
    expect(await admin.value('plugin_metadata/http-logger')).toEqual({ id: 'http-logger', max_pending_entries: 500 });

    await openEditor(page, 'plugin_metadata/http-logger');
    await unlock(page);
    await main.getByRole('spinbutton', { name: 'max_pending_entries' }).fill('600');
    await save(page);
    expect((await admin.value('plugin_metadata/http-logger'))?.max_pending_entries).toBe(600);

    await page.goto('/#/plugin_metadata');
    await expect(row(main)).toContainText(t('pm.state.configured'));
    await row(main).getByRole('button', { name: t('table.actionsFor', { name: 'http-logger' }) }).click();
    await page.getByRole('menuitem', { name: t('action.reset') }).click();
    const confirm = page.getByRole('alertdialog');
    const reset = await nextWrite(page, () => confirm.getByRole('button', { name: t('action.reset'), exact: true }).click());
    expect(reset.method).toBe('DELETE');
    expect(await admin.value('plugin_metadata/http-logger')).toBeUndefined();
    await expect(row(main)).toContainText(t('pm.state.notSet'));
  });
});

test.describe('protos', () => {
  test('created in the form with its source → listed → edited → deleted', async ({ page, admin }) => {
    const id = `${PREFIX}proto-${uid()}`;
    const source = 'syntax = "proto3";\npackage e2e;\nmessage Ping {\n  string id = 1;\n}\n';
    const main = await openNew(page, 'protos/~new');
    await idField(page).fill(id);
    await main.getByRole('textbox', { name: t('pr.general.name') }).fill(id);
    const content = await openTab(page, t('pr.tab.content'));
    await setCode(page, content.getByRole('textbox', { name: t('pr.content.label') }), source);
    await create(page);
    expect(await admin.value(`protos/${id}`)).toEqual({ id, name: id, content: source });
    await listShows(page, 'protos', id);
    await editDescription(page, admin, `protos/${id}`, `protos/${id}`, t('pr.general.desc'));
    await deleteFromEditor(page, t('kind.protos.singular'));
    expect(await admin.value(`protos/${id}`)).toBeUndefined();
    await listShows(page, 'protos', id, false);
  });
});

test.describe('secrets', () => {
  test('a Vault secret created in the form: its token is masked once stored; listed; edited; deleted', async ({ page, admin }) => {
    const id = `${PREFIX}sec-${uid()}`;
    const token = `${PREFIX}vault-token-${uid()}`;
    const main = await openNew(page, 'secrets/~new');
    // An option shows the manager's name and its id.
    await choose(page, main.getByRole('combobox', { name: new RegExp(`^${t('sc.manager.label')}`) }), `${t('sc.manager.vault')} vault`);
    await idField(page).fill(id);
    await main.getByRole('textbox', { name: /^uri\b/ }).fill('http://127.0.0.1:8200');
    await main.getByRole('textbox', { name: /^prefix\b/ }).fill('kv/apisix');
    await main.getByRole('textbox', { name: /^token\b/ }).fill(token);
    const write = await create(page);
    expect(write.path).toBe(`secrets/vault/${id}`);
    expectSameQuietly(await admin.value(`secrets/vault/${id}`), { id: `vault/${id}`, uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token }, 'the stored secret');
    // Stored and locked: the token is nowhere in the page.
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    await expectNotInPage(page, [token], 'the secret, locked after Create');
    await openEditor(page, `secrets/vault%2F${id}`);
    await expectNotInPage(page, [token], 'the secret, opened');
    await openTab(page, t('editor.json.tab'));
    await expectNotInPage(page, [token], 'the secret, JSON tab', { codeEditor: true });
    await listShows(page, 'secrets', `vault/${id}`);
    await expectNotInPage(page, [token], 'the secrets list');

    await openEditor(page, `secrets/vault%2F${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: /^uri\b/ }).fill('http://127.0.0.1:8201');
    await save(page);
    expectSameQuietly(await admin.value(`secrets/vault/${id}`), { id: `vault/${id}`, uri: 'http://127.0.0.1:8201', prefix: 'kv/apisix', token }, 'the stored secret after the edit');
    await expectNotInPage(page, [token], 'the secret, locked after Save');

    await deleteFromEditor(page, t('kind.secrets.singular'));
    expect(await admin.value(`secrets/vault/${id}`)).toBeUndefined();
    await listShows(page, 'secrets', `vault/${id}`, false);
  });
});

test.describe('stream routes', () => {
  test('created in the form → listed → edited → deleted; the seed’s stream route proxies TCP to etcd', async ({ page, admin }) => {
    const id = `${PREFIX}sr-${uid()}`;
    const main = await openNew(page, 'stream_routes/~new');
    await idField(page).fill(id);
    await main.getByRole('textbox', { name: t('sr.general.name') }).fill(id);
    const matching = await openTab(page, t('sr.tab.matching'));
    // A documentation address as the client: it never takes the stack's stream traffic.
    await matching.getByRole('textbox', { name: t('sr.match.remoteAddr') }).fill('192.0.2.40');
    await matching.getByRole('spinbutton', { name: t('sr.match.serverPort') }).fill('9100');
    const upstream = await openTab(page, t('rt.tab.upstream'));
    await upstream.getByRole('textbox', { name: t('up.nodes.new') }).fill(ECHO.host);
    await upstream.getByRole('spinbutton', { name: t('up.nodes.portN', { n: 1 }) }).fill(String(ECHO.port));
    await create(page);
    expect(await admin.value(`stream_routes/${id}`)).toEqual({
      id,
      name: id,
      remote_addr: '192.0.2.40',
      server_port: 9100,
      upstream: { nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] },
    });
    await listShows(page, 'stream_routes', id);
    await editDescription(page, admin, `stream_routes/${id}`, `stream_routes/${id}`, t('sr.general.desc'));
    await deleteFromEditor(page, t('kind.stream_routes.singular'));
    expect(await admin.value(`stream_routes/${id}`)).toBeUndefined();
    await listShows(page, 'stream_routes', id, false);

    // etcd-tcp (seed) proxies the stream port to etcd: an HTTP request over it reaches etcd.
    const answer = await new Promise<string>((resolve, reject) => {
      // HTTP/1.0: etcd answers and closes. The client does not half-close first (the proxy would drop it).
      const socket = connect(env.gatewayStream.port, env.gatewayStream.host, () => socket.write('GET /version HTTP/1.0\r\nHost: etcd\r\n\r\n'));
      let text = '';
      socket.setEncoding('utf8');
      socket.on('data', (d: string) => (text += d));
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
      socket.setTimeout(10_000, () => socket.destroy(new Error('stream proxy: timed out')));
    });
    expect(answer).toMatch(ECHO.body);
  });
});
