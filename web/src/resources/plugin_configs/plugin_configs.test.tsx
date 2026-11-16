// Plugin configs at page level, on a fake Admin API: the tabs, what each tab's save sends, the routes
// that name it (an embedded table that never writes), APISIX's delete refusal, and the list's columns.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Item, Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { sortItems } from '../../table/sort';
import { resetApp } from '../../test/app';
import { ctxOf, itemOf } from '../../test/ctx';
import { main, openEditor, writesOf } from '../../test/editor';
import { json } from '../../test/fakeAdmin';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { pluginConfigColumns } from './columns';
import { newPathFor } from '../../router/paths';

beforeAll(async () => {
  await import('./bodies');
  await import('../../plugins/PluginsTab');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const COMMON: Obj = {
  id: 'common',
  name: 'common-headers',
  desc: 'Shared headers',
  labels: { team: 'web' },
  plugins: { 'response-rewrite': { headers: { set: { 'X-Served-By': 'apisix' } } } },
  create_time: 1700000000,
  update_time: 1700000100,
};
const ROUTES: Obj[] = [
  { id: 'r1', name: 'shop', uri: '/shop', plugin_config_id: 'common', status: 1 },
  { id: 'r2', name: 'blog', uri: '/blog', status: 1 },
];
const loaded = (stored: Obj): Obj => {
  const out = { ...stored };
  delete out.create_time;
  delete out.update_time;
  return out;
};

const open = (hash: string) => openEditor(hash, { objects: { plugin_configs: [COMMON], routes: ROUTES }, replies: pluginReplies() });
const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, .pl-note:not(.pl-note--warn)')).toBeNull());
  return panel;
}

describe('a plugin config', () => {
  it('has General, Plugins, Used by and JSON; locked, every tab reads as text (the routes table included)', async () => {
    const { user } = await open('#/plugin_configs/common');
    await main().findByRole('heading', { level: 1, name: 'common-headers' });
    const labels = [t('pc.tab.general'), t('pl.tab'), t('pc.tab.usedBy')];
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual([...labels, t('editor.json.tab')]);
    for (const label of labels) {
      await user.click(tab(label));
      const panel = await settled();
      if (label === t('pc.tab.usedBy')) await within(panel).findByRole('link', { name: 'shop' });
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it("the Plugins tab says how a route's own plugins combine with these, as the route editor does", async () => {
    await open('#/plugin_configs/common?tab=plugins');
    const panel = await settled();
    expect(within(panel).getByText(t('pc.plugins.help'))).toBeInTheDocument();
  });

  it('Used by lists the routes that name it, with Edit only and a link to a new route that names it', async () => {
    const { user } = await open('#/plugin_configs/common?tab=used_by');
    const region = await main().findByRole('region', { name: t('pc.usedBy.title') });
    expect(await within(region).findByRole('link', { name: 'shop' })).toHaveAttribute('href', '#/routes/r1');
    expect(within(region).queryByText('blog')).not.toBeInTheDocument();
    expect(within(region).queryAllByRole('switch')).toEqual([]);
    expect(within(region).getByRole('link', { name: t('pc.usedBy.new') })).toHaveAttribute('href', '#/routes/~new?plugin_config_id=common');
    await user.click(within(region).getByRole('button', { name: t('table.actionsFor', { name: 'shop' }) }));
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([t('action.edit')]);
  });

  it('a save from General sends every other field (plugins, unknown ones) as loaded', async () => {
    const { user, admin } = await open('#/plugin_configs/common');
    await main().findByRole('heading', { level: 1, name: 'common-headers' });
    await settled();
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('pc.general.desc') }), '!');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_configs/common', body: { ...loaded(COMMON), desc: 'Shared headers!' } }]));
  });

  it('a save from Plugins with the last plugin removed keeps plugins: {} and every other field', async () => {
    const { user, admin } = await open('#/plugin_configs/common?tab=plugins');
    await main().findByRole('heading', { level: 1, name: 'common-headers' });
    await settled();
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('pl.card.remove', { name: 'response-rewrite' }) }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_configs/common', body: { ...loaded(COMMON), plugins: {} } }]));
  });

  it("Delete lists the routes that name it first, and shows APISIX's refusal verbatim", async () => {
    const refusal = 'can not delete this plugin config, route [r1] is still using it now';
    const { user } = await openEditor('#/plugin_configs/common', {
      objects: { plugin_configs: [COMMON], routes: ROUTES },
      replies: { ...pluginReplies(), 'plugin_configs/common': (req) => (req.method === 'DELETE' ? json(400, { error_msg: refusal }) : undefined) },
    });
    await main().findByRole('heading', { level: 1, name: 'common-headers' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('link', { name: /shop/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.plugin_configs.singular') }) }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal);
  });
});

describe('a new plugin config', () => {
  it('Create never overwrites: an id that exists is refused, linked, and the stored plugin config is unchanged', async () => {
    const { user, admin } = await open(`#${newPathFor('plugin_configs')}`);
    await settled();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'common');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    const banner = await main().findByRole('alert');
    expect(banner).toHaveTextContent(t('editor.taken.message', { kind: t('kind.plugin_configs.singular'), id: 'common' }));
    expect(within(banner).getByRole('link')).toHaveAttribute('href', '#/plugin_configs/common');
    expect(writesOf(admin)).toEqual([]);
    expect(admin.stored('plugin_configs')).toEqual([COMMON]);
  });
});

describe('the plugin configs list columns', () => {
  const col = (id: string) => {
    const column = pluginConfigColumns.find((c) => c.id === id);
    if (!column) throw new Error(id);
    return column;
  };
  const A = itemOf('a', { plugins: {} });
  const B = itemOf('b', { plugins: { cors: {} } });
  const route = (id: string, config: string): Item => itemOf(id, { uri: '/', plugin_config_id: config });

  it('name, plugins, used by and updated by default; id, desc, labels and created on demand', () => {
    expect(pluginConfigColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['name', 'plugins', 'used_by', 'updated']);
    expect(pluginConfigColumns.map((c) => c.id)).toEqual(['name', 'plugins', 'used_by', 'updated', 'created', 'id', 'desc', 'labels']);
  });

  it('used by: the routes that name it, sorted as a number; nothing until the routes have loaded', () => {
    const ctx = ctxOf({ routes: [route('r1', 'b'), route('r2', 'b'), route('r3', 'a')] });
    expect(col('used_by').accessor(B, ctx)).toBe(2);
    expect(sortItems([A, B], [{ id: 'used_by', desc: true }], pluginConfigColumns, ctx).map((i) => i.id)).toEqual(['b', 'a']);
    expect(col('used_by').accessor(B, ctxOf({ loaded: { routes: false } }))).toBeUndefined();
  });
});
