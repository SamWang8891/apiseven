// Claims match APISIX (addendum rules 16 and 18): what the dashboard says about inherited plugins,
// switches and sign-in is what APISIX does, checked at the gateway where it can be.
import {
  Admin,
  ECHO,
  echoRoute,
  echoUpstream,
  expect,
  expectNoCredentials,
  gateway,
  gatewayAnswers,
  openEditor,
  pluginCard,
  save,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-claim-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

test.describe('auth plugins on consumers and credentials', () => {
  test('a credential’s auth plugin has no switch; marked off through the Admin API it still signs in, and the gateway agrees', async ({ page, admin }) => {
    const id = uid();
    const username = `${PREFIX}${id}`.replace(/-/g, '_');
    const key = `${PREFIX}key-${id}`;
    const host = `${PREFIX}${id}.e2e.test`;
    await admin.put('consumers', { username });
    await admin.put(`consumers/${username}/credentials/${PREFIX}cred`, { plugins: { 'key-auth': { key, _meta: { disable: true } } } });
    await admin.put(`routes/${PREFIX}${id}`, echoRoute(`${PREFIX}${id}`, host, { plugins: { 'key-auth': {} } }));
    await openEditor(page, `consumers/${username}/credentials/${PREFIX}cred?tab=plugins`);
    const card = pluginCard(page, 'key-auth');
    await expect(card).toContainText(t('pl.card.signIn.stillSignsIn'));
    await expect(card.getByRole('switch')).toHaveCount(0);
    await unlock(page);
    await expect(card.getByRole('switch')).toHaveCount(0);
    await expect(card).toContainText(t('pl.card.signIn.stillSignsIn'));
    await gatewayAnswers(host, 200, { headers: { apikey: key } });
    // key-auth is in force on the route: a wrong key is refused.
    expect((await gateway(ECHO.path, { host, headers: { apikey: `${key}-wrong` } })).status).toBe(401);
  });

  test('a consumer’s own auth plugin marked off: no switch, still signs in, and the gateway agrees', async ({ page, admin }) => {
    const id = uid();
    const username = `${PREFIX}${id}`.replace(/-/g, '_');
    const key = `${PREFIX}own-${id}`;
    const host = `${PREFIX}${id}.e2e.test`;
    await admin.put('consumers', { username, plugins: { 'key-auth': { key, _meta: { disable: true } } } });
    expectNoCredentials(page, username);
    await admin.put(`routes/${PREFIX}${id}`, echoRoute(`${PREFIX}${id}`, host, { plugins: { 'key-auth': {} } }));
    await openEditor(page, `consumers/${username}?tab=plugins`);
    await unlock(page);
    const card = pluginCard(page, 'key-auth');
    await expect(card).toContainText(t('pl.card.signIn.stillSignsIn'));
    await expect(card.getByRole('switch')).toHaveCount(0);
    await gatewayAnswers(host, 200, { headers: { apikey: key } });
    expect((await gateway(ECHO.path, { host, headers: { apikey: `${key}-wrong` } })).status).toBe(401);
  });
});

test.describe('what a stream route inherits from its service', () => {
  test('with its own upstream_id it inherits nothing; without an upstream of its own it lists the service’s stream plugin', async ({ page, admin }) => {
    const id = uid();
    const service = `${PREFIX}svc-${id}`;
    const upstream = `${PREFIX}up-${id}`;
    await admin.put(`services/${service}`, { name: service, plugins: { 'ip-restriction': { whitelist: ['127.0.0.1'] } } });
    await admin.put(`upstreams/${upstream}`, { name: upstream, ...echoUpstream() });
    // Neither matches real traffic: their client address is a documentation address.
    await admin.put(`stream_routes/${PREFIX}own-${id}`, { name: `${PREFIX}own-${id}`, remote_addr: '192.0.2.10', service_id: service, upstream_id: upstream });
    await admin.put(`stream_routes/${PREFIX}via-${id}`, { name: `${PREFIX}via-${id}`, remote_addr: '192.0.2.11', service_id: service });

    let main = await openEditor(page, `stream_routes/${PREFIX}own-${id}?tab=plugins`);
    await expect(main.getByRole('tabpanel')).toContainText(t('pl.emptyLocked'));
    await expect(main.getByRole('tabpanel')).not.toContainText('ip-restriction');
    await expect(main.getByRole('list', { name: t('pl.inherited.title') })).toHaveCount(0);
    main = await openEditor(page, `stream_routes/${PREFIX}via-${id}?tab=plugins`);
    const inherited = main.getByRole('list', { name: t('pl.inherited.title') });
    await expect(inherited.getByRole('listitem')).toHaveCount(1);
    await expect(inherited.getByRole('listitem')).toContainText('ip-restriction');
    await expect(inherited.getByRole('listitem')).toContainText(t('pl.inherited.fromService'));
  });
});

test.describe('consumer groups', () => {
  test('a group’s plugin is inherited and takes effect at the gateway; the group’s auth plugin is marked as skipped', async ({ page, admin }) => {
    const id = uid();
    const group = `${PREFIX}grp-${id}`;
    const username = `${PREFIX}${id}`.replace(/-/g, '_');
    const key = `${PREFIX}gk-${id}`;
    const host = `${PREFIX}${id}.e2e.test`;
    await admin.put(`consumer_groups/${group}`, {
      plugins: {
        'response-rewrite': { headers: { set: { 'X-E2E-Group': group } } },
        'basic-auth': {},
      },
    });
    await admin.put('consumers', { username, group_id: group, plugins: { 'key-auth': { key } } });
    expectNoCredentials(page, username);
    await admin.put(`routes/${PREFIX}${id}`, echoRoute(`${PREFIX}${id}`, host, { plugins: { 'key-auth': {} } }));

    const main = await openEditor(page, `consumers/${username}?tab=plugins`);
    const panel = main.getByRole('tabpanel');
    const inherited = panel.getByRole('list', { name: t('pl.inherited.title') });
    const rewrite = inherited.getByRole('listitem').filter({ hasText: 'response-rewrite' });
    await expect(rewrite).toContainText(t('pl.inherited.fromConsumerGroup'));
    await expect(rewrite).not.toContainText(t('pl.inherited.notApplied'));
    const auth = inherited.getByRole('listitem').filter({ hasText: 'basic-auth' });
    await expect(auth).toContainText(t('pl.inherited.notApplied'));

    const reply = await gatewayAnswers(host, 200, { headers: { apikey: key } });
    expect(reply.headers['x-e2e-group']).toBe(group);
    expect(reply.text).toMatch(ECHO.body);
  });
});

test.describe('what APISIX accepts, the dashboard saves', () => {
  test('an upstream with no nodes can be saved, with a note saying requests fail until one is added', async ({ page, admin }) => {
    const id = `${PREFIX}nodes-${uid()}`;
    await admin.put(`upstreams/${id}`, { name: id, ...echoUpstream() });
    const main = await openEditor(page, `upstreams/${id}?tab=nodes`);
    await unlock(page);
    await main.getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }).click();
    await expect(main.getByText(t('up.nodes.emptyNote'))).toBeVisible();
    const write = await save(page);
    expect(write.body?.nodes).toEqual([]);
    expect((await admin.value(`upstreams/${id}`))?.nodes).toEqual([]);
  });

  test('a route whose stored URI does not start with "/" can have its description changed and saved', async ({ page, admin }) => {
    const id = `${PREFIX}uri-${uid()}`;
    await admin.put(`routes/${id}`, { name: id, uri: 'no-leading-slash', upstream: echoUpstream() });
    const stored = await admin.must(`routes/${id}`);
    const main = await openEditor(page, `routes/${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('saved although the URI never matches');
    await save(page);
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'saved although the URI never matches' });
  });
});
