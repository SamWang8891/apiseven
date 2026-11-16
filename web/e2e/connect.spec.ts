import { afterFrames, banner, env, expect, goto, openEditor, openList, recordRequests, recordWrites, saveConnections, sentWrites, settled, t, test, toast } from './fixtures';
import { freePort } from './servers';

/** A key is never an argument of an assertion that could print it: only whether it is there. */
const holds = (text: string | null | undefined, key: string) => (text ?? '').includes(key);

test.describe('the Connect page', () => {
  test.use({ connectAs: 'none' });

  async function fill(page: import('@playwright/test').Page, url: string, key: string) {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
    await page.getByRole('textbox', { name: t('connect.url') }).fill(url);
    await page.getByRole('textbox', { name: t('connect.key') }).fill(key);
  }

  test.describe('a refused key', () => {
    test.use({ allowConsole: /^401 GET .*\/apisix\/admin\/routes/ });
    test('a wrong key shows that the Admin API rejected it, with APISIX’s reason', async ({ page }) => {
      await fill(page, env.adminUrl, 'not-the-key');
      await page.getByRole('button', { name: t('connect.submit') }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(t('connect.badKey'));
      await expect(alert).toContainText('wrong apikey');
      await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
    });
  });

  test.describe('an unreachable address', () => {
    test.use({ allowConsole: /^failed GET http:\/\/127\.0\.0\.1:\d+\/apisix\/admin\/routes/ });
    test('the message names allow_admin and enable_admin_cors', async ({ page }) => {
      const url = `http://127.0.0.1:${await freePort()}`;
      await fill(page, url, env.adminKey);
      await page.getByRole('button', { name: t('connect.submit') }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(t('connect.network', { url: `${url}/apisix/admin` }));
      await expect(alert).toContainText('allow_admin');
      await expect(alert).toContainText('enable_admin_cors');
    });
  });

  test('a good key opens the routes list', async ({ page }) => {
    await fill(page, env.adminUrl, env.adminKey);
    await page.getByRole('button', { name: t('connect.submit') }).click();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
    await expect(main.getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/routes');
    // Remembered: the key is in localStorage.
    const saved = await page.evaluate(() => localStorage.getItem('apiseven.connections'));
    expect(holds(saved, env.adminKey), 'the key is in localStorage').toBe(true);
  });

  test('with "remember" off the key never reaches localStorage, and stays for this tab', async ({ page }) => {
    await fill(page, env.adminUrl, env.adminKey);
    await page.getByRole('checkbox', { name: t('connect.remember') }).click();
    await expect(page.getByRole('checkbox', { name: t('connect.remember') })).not.toBeChecked();
    await page.getByRole('button', { name: t('connect.submit') }).click();
    await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(local).toContain('apiseven.connections');
    expect(holds(local, env.adminKey), 'the key is in localStorage').toBe(false);
    const session = await page.evaluate(() => sessionStorage.getItem('apiseven.sessionKeys'));
    expect(holds(session, env.adminKey), 'the key is in sessionStorage').toBe(true);
    // A reload in the same tab stays connected.
    await page.reload();
    await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
  });
});

test.describe('a viewer (read-only) key', () => {
  test.use({ connectAs: 'viewer', allowConsole: /^40[13] (PUT|PATCH|DELETE) .*\/apisix\/admin\/routes\// });

  test('lists load; a status toggle from the keyboard is refused: the read-only banner, and the switch stays, focused and unavailable with the reason (final wave J2); Edit is then disabled', async ({ page, admin }) => {
    const main = await openList(page, 'routes');
    await expect(main.getByRole('link', { name: 'old-wiki', exact: true })).toBeVisible();
    const before = await admin.value('routes/old-wiki');
    const toggle = main.getByRole('switch', { name: t('table.status.toggle', { name: 'old-wiki' }) });
    const checked = await toggle.getAttribute('aria-checked');
    const writes = recordWrites(page);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toast(page, /invalid method for role viewer/)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: t('readOnly.banner') })).toBeVisible();
    // The switch stays where it was, at the stored state, unavailable and saying why; focus with it.
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toHaveAccessibleDescription(t('readOnly.unavailable'));
    await expect(toggle).toHaveAttribute('aria-checked', checked!);
    await afterFrames(page);
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await afterFrames(page);
    await expect(toggle).toBeFocused();
    expect(sentWrites(writes)).toEqual(['PATCH routes/old-wiki']);
    // Nothing changed in APISIX, and the list offers no New.
    expect(await admin.value('routes/old-wiki')).toEqual(before);
    await expect(main.getByRole('link', { name: t('page.new', { kind: t('kind.routes.singular') }) })).toHaveCount(0);
    // Editors open, but cannot be unlocked.
    const editor = await openEditor(page, 'routes/old-wiki');
    await expect(editor.getByRole('button', { name: t('editor.edit'), exact: true })).toBeDisabled();
  });

  test('a Save from an editor shows APISIX’s refusal and the read-only banner; nothing is stored', async ({ page, admin }) => {
    const before = await admin.value('routes/old-wiki');
    const main = await openEditor(page, 'routes/old-wiki');
    await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('a viewer cannot save this');
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    await expect(banner(page, t('editor.rejected'))).toContainText('invalid method for role viewer');
    await expect(page.getByRole('status').filter({ hasText: t('readOnly.banner') })).toBeVisible();
    expect(await admin.value('routes/old-wiki')).toEqual(before);
  });

  test('once the key is known read-only a Save sends nothing: by the button, Enter or Cmd/Ctrl-S; Save keeps focus and says why, and the draft stays', async ({ page, admin }) => {
    const before = await admin.value('routes/old-wiki');
    const main = await openEditor(page, 'routes/old-wiki');
    await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
    const desc = main.getByRole('textbox', { name: t('rt.general.desc') });
    await desc.fill('a viewer cannot save this');
    const saveButton = main.getByRole('button', { name: t('editor.save'), exact: true });
    await saveButton.click();
    await expect(page.getByRole('status').filter({ hasText: t('readOnly.banner') })).toBeVisible();
    await settled(page);
    // From here the key is known read-only: no request for the route, read or write, and no write at all.
    const sent = recordRequests(page);
    await expect(saveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(saveButton).toHaveAccessibleDescription(t('editor.readOnlySave'));
    await saveButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+s');
    await saveButton.click({ force: true });
    await afterFrames(page);
    await expect(saveButton).toBeFocused();
    await expect(desc).toHaveValue('a viewer cannot save this');
    expect(sent.filter((r) => r.includes('routes/old-wiki') || !r.startsWith('GET '))).toEqual([]);
    expect(await admin.value('routes/old-wiki')).toEqual(before);
  });

  test('a row’s Delete refused for the key: the confirm stays open, says why, keeps focus, and sends nothing more; the row menu then offers Delete no more', async ({ page, admin }) => {
    const before = await admin.value('routes/old-wiki');
    const list = await openList(page, 'routes');
    await list.getByRole('button', { name: t('table.actionsFor', { name: 'old-wiki' }) }).click();
    await page.getByRole('menuitem', { name: t('action.delete') }).click();
    const ask = page.getByRole('alertdialog');
    const confirm = ask.getByRole('button', { name: t('delete.confirm', { kind: t('kind.routes.singular') }), exact: true });
    const writes = recordWrites(page);
    await confirm.focus();
    await page.keyboard.press('Enter');
    // The banner is behind the modal dialog, hidden from the accessibility tree meanwhile.
    await expect(page.getByRole('status', { includeHidden: true }).filter({ hasText: t('readOnly.banner') })).toBeVisible();
    expect(sentWrites(writes)).toEqual(['DELETE routes/old-wiki']);
    // Known read-only now: the confirm is unavailable, with the reason, and pressing it sends nothing.
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await expect(confirm).toHaveAccessibleDescription(t('readOnly.unavailable'));
    await page.keyboard.press('Enter');
    await confirm.click({ force: true });
    await afterFrames(page);
    await expect(confirm).toBeFocused();
    await expect(ask).toBeVisible();
    expect(sentWrites(writes)).toEqual(['DELETE routes/old-wiki']);
    await ask.getByRole('button', { name: t('ui.cancel'), exact: true }).click();
    await list.getByRole('button', { name: t('table.actionsFor', { name: 'old-wiki' }) }).click();
    await expect(page.getByRole('menuitem', { name: t('action.delete') })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    expect(sentWrites(writes)).toEqual(['DELETE routes/old-wiki']);
    expect(await admin.value('routes/old-wiki')).toEqual(before);
  });
});

test.describe('two saved connections', () => {
  test.use({ connectAs: 'none' });

  test('the header menu switches between them, and requests then carry the other key', async ({ page, context }) => {
    await saveConnections(context, [
      { id: 'alpha', name: 'alpha', key: env.adminKey },
      { id: 'beta', name: 'beta', key: env.viewerKey },
    ]);
    const main = await goto(page, 'upstreams');
    await expect(main.getByRole('link', { name: 'web-pool', exact: true })).toBeVisible();
    const host = new URL(env.adminUrl).host;
    await page.getByRole('button', { name: t('header.connection', { name: 'alpha', host }) }).click();
    const withViewerKey = page.waitForRequest((r) => r.url().includes('/apisix/admin/') && r.headers()['x-api-key'] === env.viewerKey);
    await page.getByRole('menuitem', { name: `beta (${host})` }).click();
    await withViewerKey;
    await expect(page.getByRole('button', { name: t('header.connection', { name: 'beta', host }) })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'web-pool', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('apiseven.activeConnection'))).toBe('beta');
  });
});

// Task 16b item 135: the header's connection menu goes through the leave question.
test.describe('switching connections from the header with unsaved changes', () => {
  test.use({ connectAs: 'none' });
  test('16b-135: the header menu asks before dropping an editor’s unsaved changes', async ({ page, context }) => {
    await saveConnections(context, [
      { id: 'alpha', name: 'alpha', key: env.adminKey },
      { id: 'beta', name: 'beta', key: env.adminKey },
    ]);
    const main = await openEditor(page, 'routes/api-v1');
    await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('unsaved');
    const host = new URL(env.adminUrl).host;
    await page.getByRole('button', { name: t('header.connection', { name: 'alpha', host }) }).click();
    await page.getByRole('menuitem', { name: `beta (${host})` }).click();
    const leave = page.getByRole('alertdialog', { name: t('editor.leave.title') });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: t('ui.cancel') }).click();
    await expect(main.getByRole('textbox', { name: t('rt.general.desc') })).toHaveValue('unsaved');
    expect(await page.evaluate(() => localStorage.getItem('apiseven.activeConnection'))).toBe('alpha');
  });
});

test('a saved connection opens straight on the routes list', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
});
