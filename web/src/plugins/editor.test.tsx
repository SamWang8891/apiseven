// The Plugins tab inside the editor frame, as the registry wires it for every plugin-bearing kind.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import type { FakeAdminOptions } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import { getToasts } from '../ui/toast';

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', plugins: { 'limit-count': {} }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
const tab = (name: string | RegExp) => main().getByRole('tab', { name });

describe('a route with an incomplete limit-count', () => {
  it('blocks Save, badges the Plugins tab, shows the error on the card; filled in, the PUT carries numbers', async () => {
    const { user, admin } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    // The Plugins tab is the route's first tab for now, before the frame's JSON tab.
    await waitFor(() => expect(tab(/^Plugins/)).toHaveAccessibleName(`Plugins ${t('ui.tabs.errors', { count: 2 })}`));

    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('editor.save') }));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixMany', { count: 2 }));
    expect(writesOf(admin)).toEqual([]);

    const card = main().getByRole('group', { name: 'limit-count' });
    // Save opened the card that has problems.
    expect(within(card).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
    const count = within(card).getByRole('textbox', { name: 'count (required)' });
    expect(count).toHaveAccessibleDescription(t('schema.required'));

    await user.type(count, '2');
    await user.type(within(card).getByRole('textbox', { name: 'time_window (required)' }), '60');
    await waitFor(() => expect(tab(/^Plugins/)).toHaveAccessibleName(/^Plugins/));
    expect(tab(/^Plugins/)).not.toHaveAccessibleName(/to fix/);
    await user.click(main().getByRole('button', { name: t('editor.save') }));

    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const [put] = writesOf(admin);
    expect(put?.method).toBe('PUT');
    expect(put?.path).toBe('routes/r1');
    expect((put?.body?.plugins as Obj)['limit-count']).toEqual({ count: 2, time_window: 60 });
    await screen.findByText(t('editor.locked'));
  });
});

describe('every plugin-bearing kind has the Plugins tab', () => {
  it.each([
    ['services', '#/services/s1', { services: [{ id: 's1', name: 'svc', plugins: { cors: {} } }] }, 'cors'],
    ['consumers', '#/consumers/jo', { consumers: [{ username: 'jo', plugins: { 'key-auth': { key: 'k' } } }] }, 'key-auth'],
    ['global rules', '#/global_rules/g1', { global_rules: [{ id: 'g1', plugins: { prometheus: {} } }] }, 'prometheus'],
    ['stream routes', '#/stream_routes/sr1', { stream_routes: [{ id: 'sr1', plugins: { 'limit-conn': { conn: 1, burst: 0, default_conn_delay: 1, key: 'remote_addr' } } }] }, 'limit-conn'],
  ] satisfies [string, string, FakeAdminOptions['objects'], string][])('%s', async (_, hash, objects, plugin) => {
    await openEditor(hash, { objects, replies: pluginReplies() });
    const plugins = await main().findByRole('tab', { name: /^Plugins/ });
    expect(plugins).toHaveAttribute('aria-selected', 'true');
    expect(await main().findByRole('group', { name: plugin })).toBeInTheDocument();
  });

  it('a stream route is checked against the stream plugin set', async () => {
    await openEditor('#/stream_routes/sr1', { objects: { stream_routes: [{ id: 'sr1', plugins: { 'mqtt-proxy': {} } }] }, replies: pluginReplies() });
    await waitFor(() => expect(main().getByRole('tab', { name: /^Plugins/ })).toHaveAccessibleName(`Plugins ${t('ui.tabs.errors', { count: 1 })}`));
  });
});
