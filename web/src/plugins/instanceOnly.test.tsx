// Final wave D5: a plugin APISIX runs for the whole instance (scope.ts runsForInstance: ai, inspect,
// server-info, …) does nothing as an entry of an object's plugins, on or off. Its card says so instead
// of offering an enable switch, and the picker does not offer it.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { ctxOf, itemOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { pluginReplies, renderPluginsTab } from '../test/plugins';
import { entryEffect } from './entryEffect';
import { consumerInheritedPlugins, inheritedPlugins } from './inherited';

beforeAll(async () => {
  await import('../resources/routes/bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const loaded = () => waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());

describe('an entry of a plugin run for the whole instance', () => {
  it('has no enable switch and is not marked off; its badge and note say it has no effect here; its run options have no disable', async () => {
    const { user } = renderPluginsTab({ scope: 'route', value: { inspect: { _meta: { disable: true } }, ai: {}, 'limit-count': { count: 1, time_window: 60 } }, validate: false });
    await loaded();
    for (const name of ['inspect', 'ai']) {
      const card = screen.getByRole('group', { name });
      expect(within(card).queryByRole('switch', { name: t('pl.card.enable', { name }) })).toBeNull();
      expect(within(card).getByText(t('pl.card.instance'))).toBeInTheDocument();
      expect(card).not.toHaveClass('pl-card--off');
    }
    // An ordinary plugin keeps its switch.
    expect(screen.getByRole('switch', { name: t('pl.card.enable', { name: 'limit-count' }) })).toBeInTheDocument();

    const card = screen.getByRole('group', { name: 'inspect' });
    await user.click(within(card).getByRole('button', { name: 'inspect' }));
    expect(within(card).getByText(t('pl.card.instanceNote', { name: 'inspect' }))).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /^Run options/ }));
    expect(within(card).queryByRole('switch', { name: /disable/i })).toBeNull();
  });

  it('the picker does not offer one', async () => {
    const { user } = renderPluginsTab({ scope: 'global_rule', value: {}, validate: false });
    await loaded();
    await user.click(screen.getByRole('button', { name: t('pl.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    const search = within(dialog).getByRole('combobox', { name: t('pl.picker.search') });
    await user.type(search, 'inspect');
    expect(dialog.querySelector('[data-plugin="inspect"]')).toBeNull();
    await user.clear(search);
    expect(dialog.querySelector('[data-plugin="ai"]')).toBeNull();
    expect(dialog.querySelector('[data-plugin="ai-proxy"]')).not.toBeNull();
    expect(within(dialog).getByRole('option', { name: /^limit-count\b/ })).toBeInTheDocument();
  });
});

// Fix round 1, F3 (the part this file's code owns): an instance-wide entry is never "off" where it is
// inherited, and the helper the lists and overviews call says what to show.
describe('instance-wide entries elsewhere', () => {
  it('entryEffect: "noEffect" for one, whatever its _meta.disable; "off" and "on" for the others', () => {
    expect(entryEffect('inspect', { _meta: { disable: true } })).toBe('noEffect');
    expect(entryEffect('server-info', {})).toBe('noEffect');
    expect(entryEffect('my-reporter', { _meta: { disable: true } }, { schema: {}, scope: 'global' })).toBe('noEffect');
    expect(entryEffect('limit-count', { _meta: { disable: true } })).toBe('off');
    expect(entryEffect('limit-count', {})).toBe('on');
  });

  it('inherited from a service, a plugin config or a consumer group: never marked off, marked as having no effect', () => {
    const ctx = ctxOf({
      services: [itemOf('s1', { plugins: { inspect: { _meta: { disable: true } }, cors: { _meta: { disable: true } } } })],
      consumerGroups: [itemOf('g', { plugins: { ai: { _meta: { disable: true } } } })],
    });
    expect(inheritedPlugins({ uri: '/', service_id: 's1' }, ctx)).toEqual([
      { name: 'cors', from: 'service', disabled: true },
      { name: 'inspect', from: 'service', disabled: false, noEffect: true },
    ]);
    expect(consumerInheritedPlugins({ username: 'jo', group_id: 'g' }, ctx, pluginFixture().http)).toEqual([{ name: 'ai', from: 'consumer_group', disabled: false, noEffect: true }]);
  });

  it('the inherited list says "no effect here" for one, never "off"', async () => {
    renderPluginsTab({ scope: 'route', value: {}, validate: false, inherited: [{ name: 'inspect', from: 'service', disabled: false, noEffect: true }] });
    await loaded();
    const row = screen.getByText('inspect', { selector: '.pl-inherited__name' }).closest('li') as HTMLElement;
    expect(within(row).getByText(t('pl.card.instance'))).toBeInTheDocument();
    expect(within(row).queryByText(t('pl.inherited.off'))).toBeNull();
  });
});

// Fix round 1, R2.3: an instance-wide entry stored with _meta.disable and settings APISIX would refuse.
describe('an instance-wide entry marked off with settings APISIX would refuse', () => {
  const AI = { _meta: { disable: true, priority: 'high' } };

  it('its card says only what holds: the mark keeps APISIX from checking them, not a switch', async () => {
    const { user } = renderPluginsTab({ scope: 'route', value: { ai: AI }, validate: false });
    await loaded();
    const card = screen.getByRole('group', { name: 'ai' });
    await user.click(within(card).getByRole('button', { name: 'ai' }));
    const first = '_meta.priority: must be integer';
    expect(within(card).getByText(t('pl.card.uncheckedInstance', { first }))).toBeInTheDocument();
    expect(within(card).queryByText(t('pl.card.unchecked', { first }))).toBeNull();
    expect(within(card).queryByText(t('pl.card.uncheckedSignIn', { first }))).toBeNull();
  });

  it('is kept unchanged when the route is saved', async () => {
    const ROUTE = { id: 'r1', name: 'web', uri: '/a', plugins: { ai: AI }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
    const { user, admin } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: t('rt.general.name') }), '2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'web2', plugins: { ai: AI } });
  });
});
