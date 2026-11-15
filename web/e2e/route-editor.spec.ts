import type { Locator, Page } from '@playwright/test';
import {
  Admin,
  ECHO,
  banner,
  create,
  echoRoute,
  echoUpstream,
  expect,
  gatewayAnswers,
  jsonEditor,
  openEditor,
  openTab,
  operableControls,
  recordWrites,
  save,
  setCode,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-route-';
const ROUTE = t('kind.routes.singular');

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

/** A throwaway route to ECHO, stored through the Admin API; returns its id and host. */
async function storedRoute(admin: Admin, extra: Record<string, unknown> = {}): Promise<{ id: string; host: string }> {
  const id = `${PREFIX}${uid()}`;
  const host = `${id}.e2e.test`;
  await admin.put(`routes/${id}`, echoRoute(id, host, extra));
  return { id, host };
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

/** Picks an option in one of the editor's object pickers (Service, Upstream, …). */
async function pick(page: Page, picker: Locator, option: string): Promise<void> {
  await picker.click();
  await page.getByRole('option', { name: new RegExp(`^${option}\\b`) }).first().click();
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
    const field = main.getByRole('tabpanel').locator('.ui-field').filter({ has: page.getByText(t('rt.general.name'), { exact: true }) });
    const description = main.getByRole('tabpanel').locator('.ui-field').filter({ has: page.getByText(t('rt.general.desc'), { exact: true }) });
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
    const { id } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('button', { name: t('ui.tags.remove', { tag: ECHO.path }) }).click();
    await addTag(panel.getByRole('textbox', { name: /^URIs/ }), '/health');
    const write = await save(page);
    expect(write.method).toBe('PUT');
    expect(write.body?.uri).toBe('/health');
    await expect(page.getByRole('main').getByText(t('editor.locked'), { exact: true })).toBeVisible();
    expect((await admin.value(`routes/${id}`))?.uri).toBe('/health');
  });

  test('Discard puts the stored values back and sends nothing', async ({ page, admin }) => {
    const { id } = await storedRoute(admin, { desc: 'as stored' });
    const stored = await admin.value(`routes/${id}`);
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
    expect(writes).toEqual([]);
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });

  test('leaving with unsaved changes asks first: Cancel stays with the change, Discard changes leaves', async ({ page, admin }) => {
    const { id } = await storedRoute(admin);
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
    expect((await admin.value(`routes/${id}`))?.desc).toBeUndefined();
  });
});

test.describe('create', () => {
  test('a new route with a host, a URI and an inline upstream answers through the gateway with the upstream’s response', async ({ page, admin }) => {
    const id = `${PREFIX}new-${uid()}`;
    const host = `${id}.e2e.test`;
    await page.goto('/#/routes/new');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: t('editor.create'), exact: true })).toBeVisible();
    await main.getByRole('textbox', { name: t('editor.id.label'), exact: true }).fill(id);
    await main.getByRole('textbox', { name: t('rt.general.name') }).fill(id);
    let panel = await openTab(page, t('rt.tab.matching'));
    await addTag(panel.getByRole('textbox', { name: t('rt.match.hosts') }), host);
    await panel.getByRole('button', { name: t('ui.tags.remove', { tag: '/*' }) }).click();
    await addTag(panel.getByRole('textbox', { name: /^URIs/ }), ECHO.path);
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
    const { id, host } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await addTag(panel.getByRole('textbox', { name: t('rt.match.hosts') }), `two.${host}`);
    const write = await save(page);
    expect(write.body).not.toHaveProperty('host');
    expect(write.body?.hosts).toEqual([host, `two.${host}`]);
    const stored = await admin.value(`routes/${id}`);
    expect(stored).not.toHaveProperty('host');
    expect(stored?.hosts).toEqual([host, `two.${host}`]);
    await gatewayAnswers(`two.${host}`, 200);
  });
});

test.describe('the upstream a route proxies to', () => {
  test('switch from an inline upstream to an existing one, then to a service’s', async ({ page, admin }) => {
    const { id } = await storedRoute(admin);
    await openEditor(page, `routes/${id}?tab=upstream`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('radio', { name: t('rt.up.source.existing') }).click();
    const ask = page.getByRole('alertdialog', { name: t('rt.up.discard.title') });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: t('rt.up.discard.confirm') }).click();
    await pick(page, panel.getByRole('combobox', { name: t('rt.up.upstream') }), 'web-pool');
    let write = await save(page);
    expect(write.body).not.toHaveProperty('upstream');
    let stored = await admin.value(`routes/${id}`);
    expect(stored?.upstream_id).toBe('web-pool');
    expect(stored).not.toHaveProperty('upstream');

    await unlock(page);
    await pick(page, panel.getByRole('combobox', { name: t('rt.up.service') }), 'web');
    await panel.getByRole('radio', { name: t('rt.up.source.service') }).click();
    write = await save(page);
    stored = await admin.value(`routes/${id}`);
    expect(stored?.service_id).toBe('web');
    expect(stored).not.toHaveProperty('upstream_id');
    expect(stored).not.toHaveProperty('upstream');
    expect(write.body?.service_id).toBe('web');
  });
});

test.describe('conditions', () => {
  test('a vars condition decides what the gateway matches', async ({ page, admin }) => {
    const { id, host } = await storedRoute(admin);
    await gatewayAnswers(host, 200);
    await openEditor(page, `routes/${id}?tab=matching`);
    await unlock(page);
    const panel = page.getByRole('main').getByRole('tabpanel');
    await panel.getByRole('button', { name: t('rt.vars.add') }).click();
    await panel.getByRole('combobox', { name: t('rt.vars.variableN', { n: 1 }) }).fill('http_x_e2e');
    await panel.getByRole('textbox', { name: t('rt.vars.valueN', { n: 1 }) }).fill('yes');
    const write = await save(page);
    expect(write.body?.vars).toEqual([['http_x_e2e', '==', 'yes']]);
    expect((await admin.value(`routes/${id}`))?.vars).toEqual([['http_x_e2e', '==', 'yes']]);
    await gatewayAnswers(host, 404);
    await gatewayAnswers(host, 200, { headers: { 'X-E2E': 'yes' } });
  });
});

test.describe('duplicate and delete', () => {
  test('Duplicate opens a copy under a new id; Create stores it and leaves the original as it was', async ({ page, admin }) => {
    const { id } = await storedRoute(admin, { desc: 'the original', methods: ['GET'] });
    const original = await admin.value(`routes/${id}`);
    const main = await openEditor(page, `routes/${id}`);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.duplicate') }).click();
    await expect(main.getByRole('heading', { level: 1, name: t('page.new', { kind: ROUTE }) })).toBeVisible();
    await expect(main.getByRole('textbox', { name: t('rt.general.name') })).toHaveValue(t('editor.copyName', { name: id }));
    const copy = `${PREFIX}copy-${uid()}`;
    await main.getByRole('textbox', { name: t('editor.id.label'), exact: true }).fill(copy);
    await create(page);
    const stored = await admin.value(`routes/${copy}`);
    expect(stored).toEqual({ ...original, id: copy, name: t('editor.copyName', { name: id }) });
    expect(await admin.value(`routes/${id}`)).toEqual(original);
  });

  test('deleting an upstream in use lists the routes that use it; a route’s Delete removes it', async ({ page, admin }) => {
    const upstream = `${PREFIX}up-${uid()}`;
    await admin.put(`upstreams/${upstream}`, { name: upstream, ...echoUpstream() });
    const { id } = await storedRoute(admin, { upstream: undefined, upstream_id: upstream });
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
    const { id } = await storedRoute(admin, { desc: 'loaded' });
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
    expect(writes).toEqual([]);
    expect((await admin.value(`routes/${id}`))?.desc).toBe('theirs');
  });

  test('changed through the Admin API while editing: Overwrite with mine stores mine', async ({ page, admin }) => {
    const { id } = await storedRoute(admin, { desc: 'loaded' });
    const main = await openEditor(page, `routes/${id}`);
    await unlock(page);
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('mine');
    await admin.patch(`routes/${id}`, { desc: 'theirs', labels: { by: 'them' } });
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: t('editor.conflict.title', { kind: ROUTE, name: id }) });
    await dialog.getByRole('button', { name: t('editor.conflict.overwrite') }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    const stored = await admin.value(`routes/${id}`);
    expect(stored?.desc).toBe('mine');
    expect(stored).not.toHaveProperty('labels');
  });

});

test.describe('APISIX’s own refusal', () => {
  test.use({ allowConsole: /^400 PUT .*\/apisix\/admin\/routes\// });

  test('APISIX’s refusal is shown verbatim, and nothing is stored', async ({ page, admin }) => {
    const { id } = await storedRoute(admin);
    const stored = await admin.value(`routes/${id}`);
    await openEditor(page, `routes/${id}?tab=json`);
    await unlock(page);
    await setCode(page, jsonEditor(page, ROUTE), JSON.stringify({ ...stored, vars: [['arg_x', 'bogus', '1']] }, null, 2));
    await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
    await expect(banner(page)).toContainText(t('editor.rejected'));
    await expect(banner(page)).toContainText("failed to validate the 'vars' expression: invalid operator 'bogus'");
    expect(await admin.value(`routes/${id}`)).toEqual(stored);
  });
});

test.describe('fields no form shows', () => {
  test('an unknown key added in the JSON tab survives a later save from the forms', async ({ page, admin }) => {
    // APISIX refuses unknown top-level keys on a route, but keeps them inside a plugin's config and an
    // upstream node, which the forms do not model.
    const { id } = await storedRoute(admin, { plugins: { 'limit-count': { count: 5, time_window: 60 } } });
    const stored = await admin.must(`routes/${id}`);
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
    const plugins = await openTab(page, t('pl.tab'));
    await plugins.getByRole('button', { name: /^limit-count/ }).first().click();
    await plugins.getByRole('textbox', { name: /^count\b/ }).fill('7');
    await save(page);
    const after = await admin.value(`routes/${id}`);
    expect(after).toEqual({
      ...withUnknown,
      desc: 'saved from the form',
      plugins: { 'limit-count': expect.objectContaining({ count: 7, time_window: 60, x_e2e: 'kept' }) as unknown },
    });
  });
});
