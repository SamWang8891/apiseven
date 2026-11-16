import type { Locator } from '@playwright/test';
import {
  Admin,
  ECHO,
  afterFrames,
  banner,
  create,
  choose,
  echoUpstream,
  eventually,
  expect,
  expectNotFound,
  gateway,
  gatewayAnswers,
  idField,
  jsonEditor,
  nextWrite,
  openCard,
  openEditor,
  openNew,
  openTab,
  operableControls,
  recordWrites,
  save,
  sentWrites,
  setCode,
  storedRoute as stored_,
  t,
  test,
  uid,
  unlock,
  type Json,
} from './fixtures';

const PREFIX = 'e2e-route-';
const ROUTE = t('kind.routes.singular');

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

const storedRoute = (admin: Admin, extra: Json = {}) => stored_(admin, PREFIX, extra);
const URIS = new RegExp(`^${t('rt.match.uris')}\\b`);

/** A copy of `value` without the named keys. */
function without(value: Json, ...keys: string[]): Json {
  const copy = { ...value };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Adds a value to a tag field (Hosts, URIs, …): type it, then Enter. */
async function addTag(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Enter');
}

/** The box of an element, rounded. */
async function box(locator: Locator) {
  const b = (await locator.boundingBox())!;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function expectSameBox(after: { x: number; y: number; width: number; height: number }, before: typeof after, what: string) {
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after[k] - before[k]), `${what}: ${k} ${before[k]} → ${after[k]}`).toBeLessThanOrEqual(1);
  }
}


test.describe('locked by default', () => {
  test('a route opens locked: its values are shown and there is no input anywhere', async ({ page, admin }) => {
    const { id, host } = await storedRoute(admin, { desc: 'shown, not editable', labels: { team: 'e2e' }, methods: ['GET'] });
    const main = await openEditor(page, `routes/${id}`);
    await expect(main.getByText(t('editor.locked'), { exact: true })).toBeVisible();
    const general = main.getByRole('tabpanel', { name: t('rt.tab.general') });
    await expect(general).toContainText('shown, not editable');
    await expect(general.getByRole('term').filter({ hasText: 'team' })).toBeVisible();
    await expect(general.getByRole('definition').filter({ hasText: /^e2e$/ })).toBeVisible();
    await expect(general).toContainText(host);
    expect(await operableControls(page)).toEqual([]);
    const matching = await openTab(page, t('rt.tab.matching'));
    await expect(matching).toContainText(host);
    await expect(matching).toContainText(ECHO.path);
    expect(await operableControls(page)).toEqual([]);
  });

  test('E unlocks in place: the fields and the tab strip do not move', async ({ page, admin }) => {
    const { id } = await storedRoute(admin);
    const main = await openEditor(page, `routes/${id}`);
    // A field is its label's box and the value or input under it: the label's parent's parent.
    const fieldOf = (label: string) => main.getByRole('tabpanel').getByText(label, { exact: true }).locator('xpath=../..');
    const field = fieldOf(t('rt.general.name'));
    const description = fieldOf(t('rt.general.desc'));
    const before = { field: await box(field), description: await box(description), tabs: await box(main.getByRole('tablist').first()) };
    await page.keyboard.press('e');
    await expect(main.getByRole('textbox', { name: t('rt.general.name') })).toBeVisible();
    expectSameBox(await box(field), before.field, 'the Name field');
    expectSameBox(await box(description), before.description, 'the Description field');
    expectSameBox(await box(main.getByRole('tablist').first()), before.tabs, 'the tab strip');
  });
});

test.describe('edit, save, discard', () => {
  test('edit the URI → Save → locked again, and the Admin API has the new URI', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('button', { name: t('ui.tags.remove', { tag: ECHO.path }) }).click();
    await addTag(panel.getByRole('textbox', { name: URIS }), '/health');
    const write = await save(page);
    expect(write.method).toBe('PUT');
    expect(write.body?.uri).toBe('/health');
    await expect(page.getByRole('main').getByText(t('editor.locked'), { exact: true })).toBeVisible();
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, uri: '/health' });
  });

  test('Save pressed from the keyboard: once saved, the locked view’s Edit has focus', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('button', { name: t('ui.tags.remove', { tag: ECHO.path }) }).click();
    await addTag(panel.getByRole('textbox', { name: URIS }), '/health');
    const saveButton = page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true });
    await saveButton.focus();
    const write = await nextWrite(page, () => page.keyboard.press('Enter'));
    expect(write.status).toBeLessThan(300);
    const edit = page.getByRole('main').getByRole('button', { name: t('editor.edit'), exact: true });
    await expect(edit).toBeVisible();
    await afterFrames(page);
    await expect(edit).toBeFocused();
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, uri: '/health' });
  });

  test('Discard puts the stored values back and sends nothing', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin, { desc: 'as stored' });
    const main = await openEditor(page, `routes/${id}`);
    const writes = recordWrites(page);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('typed, then discarded');
    await expect(main.getByText(t('editor.unsaved'))).toBeVisible();
    await main.getByRole('button', { name: t('editor.discard'), exact: true }).click();
    await page.getByRole('alertdialog', { name: t('editor.leave.title') }).getByRole('button', { name: t('editor.leave.confirm') }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    await expect(main.getByRole('tabpanel')).toContainText('as stored');
    await expect(main.getByRole('tabpanel')).not.toContainText('typed, then discarded');
    expect(sentWrites(writes)).toEqual([]);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });

  test('leaving with unsaved changes asks first: Cancel stays with the change, Discard changes leaves', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    const main = await openEditor(page, `routes/${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('not saved yet');
    const upstreams = page.getByRole('navigation', { name: t('shell.nav') }).getByRole('link', { name: new RegExp(`^${t('kind.upstreams.plural')}`) });
    await upstreams.click();
    const ask = page.getByRole('alertdialog', { name: t('editor.leave.title') });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: t('ui.cancel') }).click();
    await expect(page).toHaveURL(new RegExp(`#/routes/${id}`));
    await expect(main.getByRole('textbox', { name: t('rt.general.desc') })).toHaveValue('not saved yet');
    await upstreams.click();
    await page.getByRole('alertdialog', { name: t('editor.leave.title') }).getByRole('button', { name: t('editor.leave.confirm') }).click();
    await expect(page).toHaveURL(/#\/upstreams$/);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });
});

test.describe('create', () => {
  test('a new route with a host, a URI and an inline upstream answers through the gateway with the upstream’s response', async ({ page, admin }) => {
    const id = `${PREFIX}new-${uid()}`;
    const host = `${id}.e2e.test`;
    const main = await openNew(page, 'routes/~new');
    await idField(page).fill(id);
    await main.getByRole('textbox', { name: t('rt.general.name') }).fill(id);
    let panel = await openTab(page, t('rt.tab.matching'));
    await addTag(panel.getByRole('textbox', { name: t('rt.match.hosts') }), host);
    await panel.getByRole('button', { name: t('ui.tags.remove', { tag: '/*' }) }).click();
    await addTag(panel.getByRole('textbox', { name: URIS }), ECHO.path);
    panel = await openTab(page, t('rt.tab.upstream'));
    await panel.getByRole('textbox', { name: t('up.nodes.new') }).fill(ECHO.host);
    await panel.getByRole('spinbutton', { name: t('up.nodes.portN', { n: 1 }) }).fill(String(ECHO.port));
    const write = await create(page);
    expect(write.path).toBe(`routes/${id}`);
    expect(await admin.value(`routes/${id}`)).toEqual({
      id,
      name: id,
      host,
      uri: ECHO.path,
      status: 1,
      upstream: { nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] },
    });
    await expect(page).toHaveURL(new RegExp(`#/routes/${id}$`));
    const reply = await gatewayAnswers(host, 200);
    expect(reply.text).toMatch(ECHO.body);
  });

  test('adding a second host turns host into hosts: the request and APISIX have hosts and no host', async ({ page, admin }) => {
    const { id, host, stored: before } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await addTag(panel.getByRole('textbox', { name: t('rt.match.hosts') }), `two.${host}`);
    const write = await save(page);
    expect(write.body).not.toHaveProperty('host');
    expect(write.body?.hosts).toEqual([host, `two.${host}`]);
    expect(await admin.value(`routes/${id}`)).toEqual({ ...without(before, 'host'), hosts: [host, `two.${host}`] });
    await gatewayAnswers(`two.${host}`, 200);
  });
});

test.describe('the upstream a route proxies to', () => {
  test('switch from an inline upstream to an existing one, then to a service’s: stored, and the gateway follows', async ({ page, admin }) => {
    const upstream = `${PREFIX}up-${uid()}`;
    const service = `${PREFIX}svc-${uid()}`;
    await admin.put(`upstreams/${upstream}`, { name: upstream, ...echoUpstream() });
    // The service's own plugin rewrites the path, so its answer tells it apart from the upstream's.
    await admin.put(`services/${service}`, { name: service, upstream: echoUpstream(), plugins: { 'proxy-rewrite': { uri: '/health' } } });
    // The route's own inline upstream cannot answer (nothing listens on its port): 502 at the gateway,
    // so the existing upstream's answer can only come from the switch.
    const { id, host, stored } = await storedRoute(admin, { upstream: { type: 'roundrobin', nodes: [{ host: ECHO.host, port: 1, weight: 1 }] } });
    const before = await gatewayAnswers(host, 502);
    expect(before.text).not.toMatch(ECHO.body);
    await openEditor(page, `routes/${id}?tab=upstream`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('radio', { name: t('rt.up.source.existing') }).click();
    const ask = page.getByRole('alertdialog', { name: t('rt.up.discard.title') });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: t('rt.up.discard.confirm') }).click();
    await choose(page, panel.getByRole('combobox', { name: t('rt.up.upstream') }), upstream);
    let write = await save(page);
    expect(write.body).not.toHaveProperty('upstream');
    expect(await admin.value(`routes/${id}`)).toEqual({ ...without(stored, 'upstream'), upstream_id: upstream });
    let reply = await eventually(() => gateway(ECHO.path, { host }), (r) => r.status === 200 && ECHO.body.test(r.text));
    expect(reply.text).toMatch(ECHO.body);

    await unlock(page);
    await choose(page, panel.getByRole('combobox', { name: t('rt.up.service') }), service);
    await panel.getByRole('radio', { name: t('rt.up.source.service') }).click();
    write = await save(page);
    expect(write.body?.service_id).toBe(service);
    expect(await admin.value(`routes/${id}`)).toEqual({ ...without(stored, 'upstream'), service_id: service });
    // The upstream's answer (etcd's /version) is not the service's (its path rewritten to /health).
    reply = await eventually(() => gateway(ECHO.path, { host }), (r) => r.status === 200 && r.text.includes('"health"'));
    expect(reply.text).toContain('"health"');
    expect(reply.text).not.toMatch(ECHO.body);
  });
});

test.describe('conditions', () => {
  test('a vars condition decides what the gateway matches', async ({ page, admin }) => {
    const { id, host, stored } = await storedRoute(admin);
    await gatewayAnswers(host, 200);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('button', { name: t('rt.vars.add') }).click();
    await panel.getByRole('combobox', { name: t('rt.vars.variableN', { n: 1 }) }).fill('http_x_e2e');
    await panel.getByRole('textbox', { name: t('rt.vars.valueN', { n: 1 }) }).fill('yes');
    const write = await save(page);
    expect(write.body?.vars).toEqual([['http_x_e2e', '==', 'yes']]);
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, vars: [['http_x_e2e', '==', 'yes']] });
    await gatewayAnswers(host, 404);
    await gatewayAnswers(host, 200, { headers: { 'X-E2E': 'yes' } });
  });
});

test.describe('duplicate and delete', () => {
  test('Duplicate opens a copy under a new id; Create stores it and leaves the original as it was', async ({ page, admin }) => {
    const { id, stored: original } = await storedRoute(admin, { desc: 'the original', methods: ['GET'] });
    const main = await openEditor(page, `routes/${id}`);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.duplicate') }).click();
    await expect(main.getByRole('heading', { level: 1, name: t('page.new', { kind: ROUTE }) })).toBeVisible();
    await expect(main.getByRole('textbox', { name: t('rt.general.name') })).toHaveValue(t('editor.copyName', { name: id }));
    const copy = `${PREFIX}copy-${uid()}`;
    await idField(page).fill(copy);
    await create(page);
    const stored = await admin.value(`routes/${copy}`);
    expect(stored).toEqual({ ...original, id: copy, name: t('editor.copyName', { name: id }) });
    expect(await admin.value(`routes/${id}`)).toEqual(original);
  });

  test('deleting an upstream in use lists the routes that use it; a route’s Delete removes it', async ({ page, admin }) => {
    const upstream = `${PREFIX}up-${uid()}`;
    await admin.put(`upstreams/${upstream}`, { name: upstream, ...echoUpstream() });
    const { id } = await storedRoute(admin, { upstream: undefined, upstream_id: upstream });
    // The editor of the route deleted below reloads it once more as it leaves.
    expectNotFound(page, `routes/${id}`);
    let main = await openEditor(page, `upstreams/${upstream}`);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.delete') }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(t('delete.inUse'));
    await expect(dialog).toContainText(id);
    await dialog.getByRole('button', { name: t('ui.cancel') }).click();
    expect(await admin.value(`upstreams/${upstream}`)).toBeDefined();

    main = await openEditor(page, `routes/${id}`);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.delete') }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: t('delete.confirm', { kind: ROUTE }) }).click();
    await expect(page).toHaveURL(/#\/routes$/);
    expect(await admin.value(`routes/${id}`)).toBeUndefined();
    await admin.del(`upstreams/${upstream}`);
  });
});

test.describe('when APISIX disagrees', () => {
  test('changed through the Admin API while editing: the conflict dialog; Reload theirs takes their version', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin, { desc: 'loaded' });
    const main = await openEditor(page, `routes/${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('mine');
    await admin.patch(`routes/${id}`, { desc: 'theirs' });
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: t('editor.conflict.title', { kind: ROUTE, name: id }) });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('theirs');
    await dialog.getByRole('button', { name: t('editor.conflict.reload') }).click();
    await expect(dialog).toBeHidden();
    // Their version replaces the draft, and the page locks again showing it.
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    await expect(main.getByRole('tabpanel')).toContainText('theirs');
    await expect(main.getByRole('tabpanel')).not.toContainText('mine');
    expect(sentWrites(writes)).toEqual([]);
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'theirs' });
  });

  test('changed through the Admin API while editing: Overwrite with mine stores mine', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin, { desc: 'loaded' });
    const main = await openEditor(page, `routes/${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('mine');
    await admin.patch(`routes/${id}`, { desc: 'theirs', labels: { by: 'them' } });
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: t('editor.conflict.title', { kind: ROUTE, name: id }) });
    await dialog.getByRole('button', { name: t('editor.conflict.overwrite') }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'mine' });
  });

});

test.describe('APISIX’s own refusal', () => {
  test.use({ allowConsole: /^400 PUT .*\/apisix\/admin\/routes\// });

  test('APISIX’s refusal is shown verbatim, and nothing is stored', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    await setCode(page, jsonEditor(page, ROUTE), JSON.stringify({ ...stored, vars: [['arg_x', 'bogus', '1']] }, null, 2));
    await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
    await expect(banner(page, t('editor.rejected'))).toContainText("failed to validate the 'vars' expression: invalid operator 'bogus'");
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });

  test('Cmd/Ctrl-S from a field, refused by APISIX: focus is back in that field (final wave I1)', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    const editor = jsonEditor(page, ROUTE);
    // APISIX refuses a key it does not know at the top of a route; the page's own checks let it through.
    await setCode(page, editor, JSON.stringify({ ...stored, x_unknown: 1 }, null, 2));
    await editor.focus();
    const writes = recordWrites(page);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(banner(page, t('editor.rejected'))).toContainText('additional properties forbidden, found x_unknown');
    await afterFrames(page);
    await expect(editor).toBeFocused();
    expect(sentWrites(writes)).toEqual([`PUT routes/${id}`]);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });

  test('Save pressed from the keyboard keeps focus while the save is out and after APISIX refuses it', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    await setCode(page, jsonEditor(page, ROUTE), JSON.stringify({ ...stored, vars: [['arg_x', 'bogus', '1']] }, null, 2));
    // The PUT is held until released, so Save can be looked at while it is out.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/apisix/admin/routes/${id}`, async (r) => {
      if (r.request().method() === 'PUT') await held;
      await r.continue();
    });
    const saveButton = page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true });
    const writes = recordWrites(page);
    await saveButton.focus();
    await page.keyboard.press('Enter');
    await expect(saveButton).toHaveAttribute('aria-busy', 'true');
    await afterFrames(page);
    await expect(saveButton).toBeFocused();
    await expect(saveButton).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    release();
    await expect(banner(page, t('editor.rejected'))).toContainText("invalid operator 'bogus'");
    await expect(saveButton).not.toHaveAttribute('aria-busy');
    await afterFrames(page);
    await expect(saveButton).toBeFocused();
    expect(sentWrites(writes)).toEqual([`PUT routes/${id}`]);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
    await page.unroute(`**/apisix/admin/routes/${id}`);
  });

  test('the header’s status switch, toggled and saved from the keyboard, keeps focus while the save is out and after APISIX refuses it', async ({ page, admin }) => {
    const { id, stored } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    await setCode(page, jsonEditor(page, ROUTE), JSON.stringify({ ...stored, vars: [['arg_x', 'bogus', '1']] }, null, 2));
    // The PUT is held until released, so the switch can be looked at while the save is out.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/apisix/admin/routes/${id}`, async (r) => {
      if (r.request().method() === 'PUT') await held;
      await r.continue();
    });
    const toggle = page.getByRole('main').getByRole('switch', { name: t('table.status.toggle', { name: id }) });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    const writes = recordWrites(page);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true })).toHaveAttribute('aria-busy', 'true');
    await afterFrames(page);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Space');
    release();
    await expect(banner(page, t('editor.rejected'))).toBeVisible();
    await expect(toggle).not.toHaveAttribute('aria-busy');
    await expect(toggle).not.toBeChecked();
    await afterFrames(page);
    await expect(toggle).toBeFocused();
    expect(sentWrites(writes)).toEqual([`PUT routes/${id}`]);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
    await page.unroute(`**/apisix/admin/routes/${id}`);
  });
});

test.describe('fields no form shows', () => {
  test('an unknown key added in the JSON tab survives a later save from the forms', async ({ page, admin }) => {
    // APISIX refuses unknown top-level keys on a route, but keeps them inside a plugin's config and an
    // upstream node, which the forms do not model.
    const { id, stored } = await storedRoute(admin, { plugins: { 'limit-count': { count: 5, time_window: 60 } } });
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    const withUnknown = {
      ...stored,
      plugins: { 'limit-count': { count: 5, time_window: 60, x_e2e: 'kept' } },
      upstream: { ...(stored.upstream as Record<string, unknown>), nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1, x_e2e: 'kept' }] },
    };
    await setCode(page, jsonEditor(page, ROUTE), JSON.stringify(withUnknown, null, 2));
    await save(page);
    expect(await admin.value(`routes/${id}`)).toEqual(withUnknown);

    // Then a form edit of something else, and one inside the plugin's form.
    await unlock(page);
    await openTab(page, t('rt.tab.general'));
    await page.getByRole('main').getByRole('textbox', { name: t('rt.general.desc') }).fill('saved from the form');
    await openTab(page, t('pl.tab'));
    const card = await openCard(page, 'limit-count');
    await card.getByRole('textbox', { name: /^count\b/ }).fill('7');
    await save(page);
    expect(await admin.value(`routes/${id}`)).toEqual({
      ...withUnknown,
      desc: 'saved from the form',
      plugins: { 'limit-count': { count: 7, time_window: 60, x_e2e: 'kept' } },
    });
  });
});
