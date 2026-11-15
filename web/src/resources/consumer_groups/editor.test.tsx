// The consumer group editor as the registry wires it, on a fake Admin API: its tabs, the locked view,
// creating one, and what Save sends from each tab.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';

beforeAll(async () => {
  await import('./bodies');
  await import('../../plugins/PluginsTab');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('cg.tab.general'), t('pl.tab'), t('cg.tab.members'), t('editor.json.tab')];

const PARTNERS: Obj = {
  id: 'partners',
  name: 'partners',
  desc: 'External partners',
  labels: { tier: 'partner' },
  plugins: { 'limit-count': { count: 1000, time_window: 3600, rejected_code: 429, group: 'partners' } },
  x_future: { kept: true },
  create_time: 1700000000,
  update_time: 1700000100,
};
const CONSUMERS: Obj[] = [{ username: 'alice', group_id: 'partners' }, { username: 'bob' }];

async function openGroup(hash = '#/consumer_groups/partners') {
  const app = await openEditor(hash, { objects: { consumer_groups: [PARTNERS], consumers: CONSUMERS }, credentials: {}, replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: 'partners' });
  return app;
}

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"], .pl-note')).toBeNull());
  return panel;
}

const loadedWith = (stored: Obj, change: Obj): Obj => {
  const rest = { ...stored };
  delete rest.create_time;
  delete rest.update_time;
  return { ...rest, ...change };
};
const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

describe('the consumer group editor', () => {
  it('has General, Plugins, Consumers and JSON, and opens on General', async () => {
    await openGroup();
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('cg.tab.general'))).toHaveAttribute('aria-selected', 'true');
  });

  it('opened locked, every tab reads as text: no form controls (the members table included)', async () => {
    const { user } = await openGroup();
    for (const label of TAB_LABELS().slice(0, 3)) {
      await user.click(tab(label));
      const panel = await settled();
      if (label === t('cg.tab.members')) await within(panel).findByRole('link', { name: 'alice' });
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it("Consumers lists the group's members only", async () => {
    await openGroup('#/consumer_groups/partners?tab=members');
    const region = await main().findByRole('region', { name: t('cg.tab.members') });
    expect(await within(region).findByRole('link', { name: 'alice' })).toBeInTheDocument();
    expect(within(region).queryByText('bob')).not.toBeInTheDocument();
  });
});

describe('a save from each tab sends every field the tab does not own exactly as loaded', () => {
  it('General: the description', async () => {
    const { user, admin } = await openGroup();
    await user.keyboard('e');
    await settled();
    await user.type(main().getByRole('textbox', { name: t('cg.general.desc') }), '!');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PUT', path: 'consumer_groups/partners', body: loadedWith(PARTNERS, { desc: 'External partners!' }) });
  });

  it('Plugins: limit-count switched off; the last plugin removed keeps plugins: {} (APISIX requires it)', async () => {
    const { user, admin } = await openGroup('#/consumer_groups/partners?tab=plugins');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: 'Enable limit-count' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const conf = (PARTNERS.plugins as Obj)['limit-count'] as Obj;
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(PARTNERS, { plugins: { 'limit-count': { ...conf, _meta: { disable: true } } } }));

    await main().findByRole('button', { name: t('editor.edit') });
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('pl.card.remove', { name: 'limit-count' }) }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]?.body).toEqual(loadedWith(PARTNERS, { plugins: {} }));
  });
});

describe('creating a consumer group', () => {
  it('asks for an ID; Create PUTs consumer_groups/<id> with an empty plugins object', async () => {
    const { user, admin } = await openEditor('#/consumer_groups/new', { objects: { consumer_groups: [], consumers: [] }, replies: pluginReplies() });
    await settled();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'staff');
    await user.type(main().getByRole('textbox', { name: t('cg.general.name') }), 'Staff');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumer_groups/staff', body: { plugins: {}, name: 'Staff' } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/consumer_groups/staff'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
  });
});
