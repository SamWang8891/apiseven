// Accessibility scans with axe-core, in light and in dark: no colour-contrast violation, and no
// serious or critical violation of any rule, on the pages people spend their time in.
//
// One exclusion, for one rule on three controls (NAMED_BY_TITLE, which every scan checks matches
// nothing else): label-content-name-mismatch (WCAG 2.5.3) reads every word shown on a button as its
// label. These three show more than their name: the header's search button its shortcut hint (also
// given as aria-keyshortcuts), a plugin card's and a collapsible section's toggle a one-line summary
// (and a card its category) after the title, which is the name; the rest is their description
// (aria-describedby). The mismatch is real.
// The way out is structural and keeps every name: move the summary, the category and the shortcut
// hint out of the three buttons into siblings, laid out by CSS and still referenced by
// aria-describedby; then this exclusion goes. That is a recorded follow-up: Task 16b, now merged, left
// the three as they were. Every other rule, and this rule on every other element, runs everywhere.
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

/**
 * The three, told by their ARIA, not their classes: the button with a keyboard shortcut and a name of
 * its own (the header's search; Edit and Save have a shortcut but are named by their text), and the
 * buttons named by their title (aria-labelledby) that open and close a part (a plugin card's or a
 * section's toggle).
 */
const NAMED_BY_TITLE = 'button[aria-keyshortcuts][aria-label], button[aria-expanded][aria-labelledby]';

/**
 * The exclusion cannot grow by itself: everything on the page the selector matches must be one of the
 * three, known by structure. The search opens the palette (named "Search"), at most one of it; a
 * toggle is named by the same title as the plugin card (a group) or the section it opens. Anything
 * else the selector matches is listed.
 */
async function expectOnlyTheThree(page: Page, what: string): Promise<void> {
  const others = await page.evaluate(
    ([sel, search]) => {
      const matched = [...document.querySelectorAll(sel)];
      const searches = matched.filter((el) => el.getAttribute('aria-label') === search && el.getAttribute('aria-haspopup') === 'dialog');
      const toggles = matched.filter((el) => {
        const by = el.getAttribute('aria-labelledby');
        return by !== null && (el.closest('[role="group"]')?.getAttribute('aria-labelledby') === by || el.closest('section')?.getAttribute('aria-labelledby') === by);
      });
      const known = new Set([...searches.slice(0, 1), ...toggles]);
      return matched.filter((el) => !known.has(el)).map((el) => el.outerHTML.slice(0, 160));
    },
    [NAMED_BY_TITLE, t('palette.open')] as const,
  );
  expect(others, `${what}: the axe exclusion's selector matches only the three controls`).toEqual([]);
}

async function scan(page: Page, what: string): Promise<void> {
  await settled(page);
  await still(page);
  await expectOnlyTheThree(page, what);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const excusable = async (id: string, target: string) =>
    id === 'label-content-name-mismatch' && (await page.evaluate(([sel, named]) => document.querySelector(sel)?.matches(named) ?? false, [target, NAMED_BY_TITLE] as const));
  const failing = [];
  for (const v of violations.filter((x) => x.id === 'color-contrast' || x.impact === 'serious' || x.impact === 'critical')) {
    const nodes = [];
    for (const n of v.nodes) if (!(await excusable(v.id, String(n.target[0])))) nodes.push(n);
    if (nodes.length > 0) failing.push({ ...v, nodes });
  }
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
      expect(labels).toEqual([t('rt.tab.general'), t('rt.tab.matching'), t('rt.tab.upstream'), t('pl.tab'), t('rt.tab.advanced'), t('editor.json.tab')]);
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
      await goto(page, 'routes/~new');
      await expect(page.getByRole('main').getByRole('button', { name: t('editor.create'), exact: true })).toBeVisible();
      await scan(page, 'a new route');
    });
  });
}
