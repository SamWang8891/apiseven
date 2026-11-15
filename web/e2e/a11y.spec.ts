// Accessibility scans with axe-core, in light and in dark: no colour-contrast violation, and no
// serious or critical violation of any rule, on the pages people spend their time in.
//
// One exclusion, for one rule on three controls (see NAMED_BY_TITLE): label-content-name-mismatch reads
// every word shown on a button as its label. These three show more than their label: the header's
// search button its shortcut hint (also given as aria-keyshortcuts), a plugin card's and a collapsible
// section's toggle a one-line summary (and a card its category) after the title. Each is named by its
// title and described (aria-describedby) by the rest, so a screen reader announces the title, then the
// summary; a speech user says the title shown first on the button. Every other rule, and this rule on
// every other element, runs everywhere.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { env, expect, goto, openCard, openEditor, openList, openTab, settled, t, test, unlock } from './fixtures';

/** Waits for running (finite) animations, so a fading overlay is not measured mid-way. */
async function still(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

const NAMED_BY_TITLE = /^<button[^>]* class="[^"]*\b(shell-search|pl-card__toggle|res-section__toggle)\b/;

async function scan(page: Page, what: string): Promise<void> {
  await settled(page);
  await still(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const excused = (id: string, html: string) => id === 'label-content-name-mismatch' && NAMED_BY_TITLE.test(html);
  const failing = violations
    .filter((v) => v.id === 'color-contrast' || v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !excused(v.id, n.html)) }))
    .filter((v) => v.nodes.length > 0);
  const described = failing.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`));
  expect(described, `axe on ${what}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test.describe('the Connect page', () => {
      test.use({ connectAs: 'none', allowConsole: /^401 GET .*\/apisix\/admin\/routes/ });
      test('Connect, empty and with a refused key', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
        await scan(page, 'Connect');
        await page.getByRole('textbox', { name: t('connect.url') }).fill(env.adminUrl);
        await page.getByRole('textbox', { name: t('connect.key') }).fill('not-the-key');
        await page.getByRole('button', { name: t('connect.submit') }).click();
        await expect(page.getByRole('alert')).toContainText(t('connect.badKey'));
        await scan(page, 'Connect with a refused key');
      });
    });

    test('the routes list, as it opens and grouped by host', async ({ page }) => {
      const main = await openList(page, 'routes');
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      await scan(page, 'the routes list');
      await main.getByRole('switch', { name: t('group.byHost') }).click();
      await expect(main.getByRole('rowheader').first()).toBeVisible();
      await scan(page, 'the routes list grouped by host');
    });

    test('the route editor: every tab locked, then every tab in Edit', async ({ page }) => {
      test.setTimeout(180_000);
      const main = await openEditor(page, 'routes/api-v1');
      const tabs = main.getByRole('tablist').first().getByRole('tab');
      const labels = (await tabs.allTextContents()).map((l) => l.trim());
      for (const label of labels) {
        await openTab(page, label);
        await scan(page, `api-v1, ${label}, locked`);
      }
      await unlock(page);
      for (const label of labels) {
        await openTab(page, label);
        await scan(page, `api-v1, ${label}, editing`);
      }
    });

    test('a plugin card open in its form', async ({ page }) => {
      await openEditor(page, 'routes/api-v1?tab=plugins');
      await unlock(page);
      const card = await openCard(page, 'limit-count');
      await expect(card.getByRole('textbox', { name: /^count\b/ })).toBeVisible();
      await scan(page, 'the limit-count card in Form');
    });

    test('an upstream editor, locked and in Edit', async ({ page }) => {
      const main = await openEditor(page, 'upstreams/api-backend');
      await scan(page, 'api-backend, General, locked');
      await openTab(page, t('up.section.nodes'));
      await unlock(page);
      await scan(page, 'api-backend, Nodes, editing');
      await openTab(page, t('up.section.health'));
      await main.getByRole('switch', { name: t('up.hc.active') }).click();
      await scan(page, 'api-backend, Health checks on, editing');
    });

    test('the SSL editor, locked and in Edit', async ({ page }) => {
      await openEditor(page, 'ssls/apiseven-test');
      await scan(page, 'the SSL certificate, Certificate, locked');
      await unlock(page);
      for (const label of [t('ssl.tab.certificate'), t('ssl.tab.snis'), t('ssl.tab.client'), t('ssl.tab.general')]) {
        await openTab(page, label);
        await scan(page, `the SSL certificate, ${label}, editing`);
      }
    });

    test('a new route (its required fields still empty)', async ({ page }) => {
      await goto(page, 'routes/new');
      await expect(page.getByRole('main').getByRole('button', { name: t('editor.create'), exact: true })).toBeVisible();
      await scan(page, 'a new route');
    });
  });
}
