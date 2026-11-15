// Global rules at page level, on a fake Admin API: the Plugins tab with what APISIX does with them,
// removing the last plugin, a plugin another rule holds, create never overwrites, secrets in a
// plugin kept through saves, and the list.
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

const DEFAULT: Obj = { id: 'default', plugins: { 'request-id': { header_name: 'X-Request-Id', include_in_response: true } }, create_time: 1700000000, update_time: 1700000100 };
const LOGS: Obj = { id: 'logs', plugins: { 'http-logger': { uri: 'http://127.0.0.1:1980/log', auth_header: 'Bearer stored-secret' } } };

const open = (hash: string, rules: Obj[] = [DEFAULT, LOGS]) => openEditor(hash, { objects: { global_rules: rules }, replies: pluginReplies() });
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, .pl-note:not(.pl-note--warn)')).toBeNull());
  return panel;
}

describe('a global rule', () => {
  it('opens on Plugins, under what APISIX does with them; locked, no form controls', async () => {
    await open('#/global_rules/default');
    expect(await main().findByRole('heading', { level: 1, name: 'default' })).toBeInTheDocument();
    expect(main().getAllByRole('tab').map((tab) => tab.textContent)).toEqual([t('pl.tab'), t('editor.json.tab')]);
    const panel = await settled();
    const explainer = within(panel).getByRole('region', { name: t('gr.explainer.title') });
    for (const key of ['gr.explainer.every', 'gr.explainer.order', 'gr.explainer.prefer', 'gr.explainer.once']) expect(explainer).toHaveTextContent(t(key));
    await within(panel).findByRole('group', { name: 'request-id' });
    expect(editableControls(panel)).toEqual([]);
  });

  it('with all its plugins removed, still sends plugins: {} (APISIX requires it)', async () => {
    const { user, admin } = await open('#/global_rules/default');
    await main().findByRole('heading', { level: 1, name: 'default' });
    await settled();
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('pl.card.remove', { name: 'request-id' }) }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'global_rules/default', body: { id: 'default', plugins: {} } }]));
  });

  it('a plugin another global rule holds: a note says APISIX refuses it, and its refusal lands on the plugin card', async () => {
    const { user, admin } = await open('#/global_rules/default');
    await main().findByRole('heading', { level: 1, name: 'default' });
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('pl.add') }));
    const picker = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    await user.type(within(picker).getByRole('combobox', { name: t('pl.picker.search') }), 'http-logger');
    await user.click(within(picker).getByRole('option', { name: /^http-logger\b/ }));
    expect(await main().findByRole('note')).toHaveTextContent(t('gr.elsewhere', { id: 'logs', names: 'http-logger' }));
    const card = main().getByRole('group', { name: 'http-logger' });
    await user.type(within(card).getByRole('textbox', { name: 'uri (required)' }), 'http://x');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const refusal = "plugin 'http-logger' already exists in global rule with id 'logs'";
    // APISIX's message, verbatim in the banner and on the card it names (editor/issues.ts ERROR_PATHS).
    await waitFor(() => expect(main().getAllByRole('alert')[0]).toHaveTextContent(refusal));
    expect(main().getByRole('group', { name: 'http-logger' })).toHaveTextContent(refusal);
    expect(main().getByRole('tab', { name: new RegExp(`^${t('pl.tab')}`) })).toHaveTextContent(t('ui.tabs.errors', { count: 1 }));
    expect(admin.stored('global_rules')[0]).toEqual(DEFAULT);
  });

  it('a secret inside a plugin (http-logger auth_header) is sent back as stored by saves that leave it alone', async () => {
    const { user, admin } = await open('#/global_rules/logs');
    await main().findByRole('heading', { level: 1, name: 'logs' });
    await settled();
    for (const uri of ['http://127.0.0.1:1980/a', 'http://127.0.0.1:1980/b']) {
      await main().findByRole('button', { name: t('editor.edit') });
      await user.keyboard('e');
      const card = main().getByRole('group', { name: 'http-logger' });
      if (!within(card).queryByRole('textbox', { name: 'uri (required)' })) await user.click(within(card).getByRole('button', { name: 'http-logger' }));
      const field = within(card).getByRole('textbox', { name: 'uri (required)' });
      await user.clear(field);
      await user.type(field, uri);
      await save(user);
    }
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    for (const write of writesOf(admin)) expect((write.body?.plugins as Obj)['http-logger']).toMatchObject({ auth_header: 'Bearer stored-secret' });
    expect(screen.getByRole('main').textContent).not.toContain('stored-secret');
  });
});

describe('a new global rule', () => {
  it('asks for an ID; Create PUTs global_rules/<id> with an empty plugins object', async () => {
    const { user, admin } = await open('#/global_rules/new', []);
    await settled();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'g2');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'global_rules/g2', body: { plugins: {} } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/global_rules/g2'));
  });

  it('Create never overwrites: an id that exists is refused and the stored rule is unchanged', async () => {
    const { user, admin } = await open('#/global_rules/new');
    await settled();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'default');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(await main().findByRole('alert')).toHaveTextContent(t('editor.taken.message', { kind: t('kind.global_rules.singular'), id: 'default' }));
    expect(writesOf(admin)).toEqual([]);
    expect(admin.stored('global_rules')[0]).toEqual(DEFAULT);
  });
});

describe('the global rules list', () => {
  it('id (a link), plugins with a switched-off one marked off, and when it changed; no credential in the page or found by search', async () => {
    const OFF: Obj = { id: 'quiet', plugins: { cors: { _meta: { disable: true } } } };
    const { user } = await openEditor('#/global_rules', { objects: { global_rules: [DEFAULT, LOGS, OFF] } });
    const link = await main().findByRole('link', { name: 'default' });
    expect(link).toHaveAttribute('href', '#/global_rules/default');
    expect(link.closest('tr')).toHaveTextContent('request-id');
    expect((await main().findByRole('link', { name: 'quiet' })).closest('tr')).toHaveTextContent(`cors${t('cell.plugin.off')}`);
    expect(screen.getByRole('main').textContent).not.toContain('stored-secret');
    const search = main().getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.global_rules.plural') }) });
    await user.type(search, 'stored-secret');
    await waitFor(() => expect(main().queryByRole('link', { name: 'logs' })).not.toBeInTheDocument());
  });
});
