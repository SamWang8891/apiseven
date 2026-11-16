import {
  Admin,
  ECHO,
  choose,
  create,
  deleteFromEditor,
  echoUpstream,
  expect,
  gatewayAnswers,
  idField,
  listShows,
  openEditor,
  openNew,
  openTab,
  save,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-svc-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

test('a service: created in the form → in the list → a route made in it proxies through its upstream → edited → deleted', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const upstream = `${PREFIX}up-${uid()}`;
  const host = `${id}.e2e.test`;
  await admin.put(`upstreams/${upstream}`, { name: upstream, ...echoUpstream() });

  const main = await openNew(page, 'services/~new');
  await idField(page).fill(id);
  await main.getByRole('textbox', { name: t('svc.general.name') }).fill(id);
  const hosts = main.getByRole('textbox', { name: t('svc.general.hosts') });
  await hosts.fill(host);
  await hosts.press('Enter');
  const up = await openTab(page, t('rt.tab.upstream'));
  await up.getByRole('radio', { name: t('rt.up.source.existing') }).click();
  await choose(page, up.getByRole('combobox', { name: t('rt.up.upstream') }), upstream);
  await create(page);
  expect(await admin.value(`services/${id}`)).toEqual({ id, name: id, hosts: [host], upstream_id: upstream });

  await listShows(page, 'services', id);

  // "New route in this service": the route takes the service's hosts and upstream.
  await openEditor(page, `services/${id}?tab=routes`);
  await page.getByRole('main').getByRole('link', { name: t('svc.routes.newRoute') }).first().click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t('page.new', { kind: t('kind.routes.singular') }) })).toBeVisible();
  const route = `${PREFIX}route-${uid()}`;
  await idField(page).fill(route);
  const matching = await openTab(page, t('rt.tab.matching'));
  await matching.getByRole('button', { name: t('ui.tags.remove', { tag: '/*' }) }).click();
  const uris = matching.getByRole('textbox', { name: new RegExp(`^${t('rt.match.uris')}\\b`) });
  await uris.fill(ECHO.path);
  await uris.press('Enter');
  const routeUp = await openTab(page, t('rt.tab.upstream'));
  await expect(routeUp.getByRole('radio', { name: t('rt.up.source.service') })).toBeChecked();
  await create(page);
  expect(await admin.value(`routes/${route}`)).toEqual({ id: route, uri: ECHO.path, service_id: id, status: 1 });
  const reply = await gatewayAnswers(host, 200);
  expect(reply.text).toMatch(ECHO.body);
  await admin.del(`routes/${route}`);

  await openEditor(page, `services/${id}`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('svc.general.desc') }).fill('edited');
  await save(page);
  expect((await admin.value(`services/${id}`))?.desc).toBe('edited');

  await deleteFromEditor(page, t('kind.services.singular'));
  expect(await admin.value(`services/${id}`)).toBeUndefined();
  await listShows(page, 'services', id, false);
});
