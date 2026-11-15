// Shared by the two "every kind, every tab" specs (tabs-traffic, tabs-access): each object carries an
// unknown key `x_e2e` where APISIX keeps one (inside a plugin's config and an upstream node; every
// kind's top level refuses unknown keys, except secrets and plugin metadata; SSLs and protos take none
// anywhere). Tabs that own no field (a service's Routes, a consumer's Credentials, a group's
// Consumers, a plugin config's Used by) are covered by lock.spec.ts.
import type { Page } from '@playwright/test';
import { Admin, ECHO, changeOnTab, openCard, t, test, type Json, type TabChange } from './fixtures';

export const PREFIX = 'e2e-tabs-';
export const KEPT = 'kept';
export const node = (extra: Json = {}) => ({ host: ECHO.host, port: ECHO.port, weight: 1, x_e2e: KEPT, ...extra });

/** The description field of a General tab. */
export const desc = (tab: string, label: string): TabChange => ({
  tab,
  field: 'desc',
  value: () => `changed on ${tab}`,
  change: async (panel) => {
    await panel.getByRole('textbox', { name: label, exact: true }).fill(`changed on ${tab}`);
  },
});

/** A plugin card's field, typed or numeric: the form shows numbers that also take text as textboxes. */
export async function pluginField(page: Page, plugin: string, field: string, value: string) {
  const card = await openCard(page, plugin);
  const name = new RegExp(`^${field}\\b`);
  await card.getByRole('spinbutton', { name }).or(card.getByRole('textbox', { name })).first().fill(value);
}

/** The weight of node 1 in an inline upstream. */
export const nodeWeight = (tab: string, field = 'upstream'): TabChange => ({
  tab,
  field,
  value: (before) => {
    const up = before[field] as Json;
    return { ...up, nodes: [{ ...(up.nodes as Json[])[0], weight: 5 }] };
  },
  change: async (panel) => {
    await panel.getByRole('spinbutton', { name: t('up.nodes.weightN', { n: 1 }) }).fill('5');
  },
});

/** One object of a kind, made through the Admin API, and one test per tab change. */
export function kind(name: string, setup: { editor: string; api: string; create: (admin: Admin) => Promise<void> }, changes: TabChange[]) {
  test.describe(name, () => {
    test.beforeAll(async () => {
      await setup.create(new Admin());
    });
    for (const change of changes) {
      test(`${name}, ${change.tab} tab: a change to ${change.field} is saved, and nothing else changes`, async ({ page, admin }) => {
        await changeOnTab(page, admin, setup.editor, setup.api, change);
      });
    }
  });
}
