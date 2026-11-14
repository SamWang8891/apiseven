// The Plugins tab inside the editor frame, as the registry wires it for every plugin-bearing kind.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import type { FakeAdminOptions } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import { getToasts } from '../ui/toast';

// A route's tabs load their module on first view; load it up front, so a test's first query doesn't
// meet the loading placeholder.
beforeAll(async () => {
  await import('../resources/routes/bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', plugins: { 'limit-count': {} }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
const tab = (name: string | RegExp) => main().getByRole('tab', { name });

describe('a route with an incomplete limit-count', () => {
  it('blocks Save, badges the Plugins tab, shows the error on the card; filled in, the PUT carries numbers', async () => {
    const { user, admin } = await openEditor('#/routes/r1?tab=plugins', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
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

/** Replaces a CodeMirror editor's text: select all, then paste (typing `{` would be auto-closed). */
async function replaceCode(user: UserEvent, box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

/** r1 with `plugins`, opened, unlocked, with the card of `open` opened. */
async function editRoute(plugins: Obj, open: string) {
  const app = await openEditor('#/routes/r1?tab=plugins', { objects: { routes: [{ ...ROUTE, plugins }] }, replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: 'web' });
  await waitFor(() => expect(tab(/^Plugins/)).toHaveAccessibleName('Plugins'));
  await app.user.keyboard('e');
  const card = main().getByRole('group', { name: open });
  await app.user.click(within(card).getByRole('button', { name: open }));
  return { ...app, card };
}

const holders: [string, Obj, string, (user: UserEvent, card: HTMLElement) => Promise<void>, string][] = [
  [
    '1. a number field showing "-"',
    { 'limit-count': { count: 2, time_window: 60 } },
    'limit-count',
    (user, card) => user.type(within(card).getByRole('spinbutton', { name: 'rejected_code' }), '-'),
    t('ui.pending.notNumber', { field: 'limit-count.rejected_code', text: '-' }),
  ],
  [
    '2, 6. tag text the item schema refuses (typed, not added: Save adds it first)',
    { 'referer-restriction': { whitelist: ['a.example.org'] } },
    'referer-restriction',
    (user, card) => user.type(within(card).getByRole('textbox', { name: /^whitelist/ }), 'bad host!'),
    t('ui.pending.tag', { field: 'referer-restriction.whitelist', text: 'bad host!', reason: t('sf.pattern.invalid', { pattern: '^\\*$|^\\*?[0-9a-zA-Z-._\\[\\]:]+$' }) }),
  ],
  [
    '3. a key/value row with a value and no key',
    { mocking: { response_example: 'ok', response_headers: { 'X-A': 'a' } } },
    'mocking',
    async (user, card) => {
      const headers = within(within(card).getByRole('group', { name: /^response_headers/ }));
      await user.click(headers.getByRole('button', { name: t('ui.kv.add') }));
      await user.type(headers.getByRole('textbox', { name: t('ui.kv.valueN', { n: 2 }) }), 'b');
    },
    t('ui.pending.noKey', { field: 'mocking.response_headers', n: 2 }),
  ],
  [
    '4. a map row with a key and no value',
    { 'kafka-logger': { broker_list: { '10.0.0.1': 9092 }, kafka_topic: 't' } },
    'kafka-logger',
    async (user, card) => {
      const brokers = within(within(card).getByRole('group', { name: /^broker_list/ }));
      await user.click(brokers.getByRole('button', { name: t('sf.map.add') }));
      await user.type(brokers.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), '10.0.0.2');
    },
    t('ui.pending.noValue', { field: 'kafka-logger.broker_list', key: '10.0.0.2' }),
  ],
  [
    '5. inline JSON that does not parse',
    { 'response-rewrite': { body: 'x', vars: [['arg_a', '==', '1']] } },
    'response-rewrite',
    async (user, card) => replaceCode(user, await within(card).findByRole('textbox', { name: t('sf.json.label', { key: 'vars' }) }), '[["arg_a", '),
    t('ui.pending.json', { field: 'response-rewrite.vars' }),
  ],
  [
    "7. the card's JSON view with text that does not parse",
    { 'limit-count': { count: 2, time_window: 60 } },
    'limit-count',
    async (user, card) => {
      await user.click(within(card).getByRole('button', { name: t('pl.card.json') }));
      await replaceCode(user, await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) }), '{"count": 2,');
    },
    t('ui.pending.json', { field: 'limit-count' }),
  ],
  [
    "8. _meta's filter with text that does not parse",
    { 'limit-count': { count: 2, time_window: 60 } },
    'limit-count',
    async (user, card) => {
      await user.click(within(card).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
      await replaceCode(user, await within(card).findByRole('textbox', { name: t('pl.meta.filterLabel') }), '[["arg_v"');
    },
    t('ui.pending.json', { field: 'limit-count._meta.filter' }),
  ],
];

describe('a field holding input it has not emitted blocks Save, named in the question a tab switch asks', () => {
  it.each(holders)('%s', async (_, plugins, open, hold, message) => {
    const { user, admin, card } = await editRoute(plugins, open);
    await hold(user, card);
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    // The toast says which field and why.
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message }));
    expect(tab(/^Plugins/)).toHaveAccessibleName(`Plugins ${t('ui.tabs.errors', { count: 1 })}`);
    // Cmd/Ctrl-S takes the same path.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);

    await user.click(tab(/^JSON/));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(message);
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    expect(tab(/^Plugins/)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('what a field shows is what gets saved', () => {
  it('tag text typed without Enter is in the PUT, and a number typed is; a cleared number leaves its key out', async () => {
    const { user, admin, card } = await editRoute({ 'limit-count': { count: 2, time_window: 60, rejected_code: 503 }, 'referer-restriction': { whitelist: ['a.example.org'] } }, 'limit-count');
    const code = within(card).getByRole('spinbutton', { name: 'rejected_code' });
    await user.clear(code);
    const referer = main().getByRole('group', { name: 'referer-restriction' });
    await user.click(within(referer).getByRole('button', { name: 'referer-restriction' }));
    await user.type(within(referer).getByRole('textbox', { name: /^whitelist/ }), 'b.example.org');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.plugins).toEqual({
      'limit-count': { count: 2, time_window: 60 },
      'referer-restriction': { whitelist: ['a.example.org', 'b.example.org'] },
    });
  });

  it('Cmd/Ctrl-S in the tag box saves the text typed there, without Enter', async () => {
    const { user, admin, card } = await editRoute({ 'referer-restriction': { whitelist: ['a.example.org'] } }, 'referer-restriction');
    const box = within(card).getByRole('textbox', { name: /^whitelist/ });
    await user.type(box, 'b.example.org');
    fireEvent.keyDown(box, { key: 's', ctrlKey: true });
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.plugins).toEqual({ 'referer-restriction': { whitelist: ['a.example.org', 'b.example.org'] } });
  });

  it('a number field showing "-" refuses Save; cleared, Save goes through without the key', async () => {
    const { user, admin, card } = await editRoute({ 'limit-count': { count: 2, time_window: 60, rejected_code: 503 } }, 'limit-count');
    const code = within(card).getByRole('spinbutton', { name: 'rejected_code' });
    await user.clear(code);
    await user.type(code, '-');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(code).toHaveFocus();
    await user.clear(code);
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.plugins).toEqual({ 'limit-count': { count: 2, time_window: 60 } });
  });

  it('tag text the schema refuses: no PUT, the error on the field, the text still there', async () => {
    const { user, admin, card } = await editRoute({ 'referer-restriction': { whitelist: ['a.example.org'] } }, 'referer-restriction');
    const box = within(card).getByRole('textbox', { name: /^whitelist/ });
    await user.type(box, 'bad host!');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(box).toHaveValue('bad host!');
    expect(box).toHaveAccessibleDescription(t('sf.pattern.invalid', { pattern: '^\\*$|^\\*?[0-9a-zA-Z-._\\[\\]:]+$' }));
  });

  it("the card's JSON view with text that does not parse: collapsing is refused, and Save; the text stays", async () => {
    const { user, admin, card } = await editRoute({ 'limit-count': { count: 2, time_window: 60 } }, 'limit-count');
    await user.click(within(card).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replaceCode(user, box, '{"count": 2,');
    await user.click(within(card).getByRole('button', { name: 'limit-count' }));
    expect(within(card).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);
    expect(box.textContent).toBe('{"count": 2,');
    expect(box).toHaveFocus();
  });

  it('a successful Save keeps the open card open and the tab where it was', async () => {
    const { user, admin, card } = await editRoute({ 'limit-count': { count: 2, time_window: 60 } }, 'limit-count');
    await user.type(within(card).getByRole('spinbutton', { name: 'rejected_code' }), '429');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(tab(/^Plugins/)).toHaveAttribute('aria-selected', 'true');
    expect(within(main().getByRole('group', { name: 'limit-count' })).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe("held JSON text in a card is never replaced by the card's other controls", () => {
  async function brokenCard() {
    const app = await editRoute({ 'limit-count': { count: 2, time_window: 60 } }, 'limit-count');
    await app.user.click(within(app.card).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(app.card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replaceCode(app.user, box, '{"count": 3,');
    return { ...app, box };
  }
  const held = t('ui.pending.json', { field: 'limit-count' });

  it('the enable switch is refused while the JSON view holds text; fixed, the PUT has the fixed config and no switch change', async () => {
    const { user, admin, card, box } = await brokenCard();
    const enabled = within(card).getByRole('switch', { name: t('pl.card.enable', { name: 'limit-count' }) });
    await user.click(enabled);
    expect(enabled).toBeChecked();
    expect(getToasts().at(-1)?.message).toBe(t('ui.pending.refused', { message: held }));
    expect(box.textContent).toBe('{"count": 3,');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held }));
    expect(writesOf(admin)).toEqual([]);

    await replaceCode(user, box, '{"count": 3, "time_window": 60}');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.plugins).toEqual({ 'limit-count': { count: 3, time_window: 60 } });
  });

  it('_meta cannot be edited while the JSON view holds text (it is part of that JSON); fixed, the PUT is the fixed config', async () => {
    const { user, admin, card, box } = await brokenCard();
    await user.click(within(card).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    expect(within(card).queryByRole('spinbutton', { name: 'priority' })).not.toBeInTheDocument();
    expect(within(card).getByText(t('pl.meta.heldByJson'))).toBeInTheDocument();
    expect(box.textContent).toBe('{"count": 3,');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toEqual([]);

    await replaceCode(user, box, '{"count": 3, "time_window": 60}');
    const priority = await within(card).findByRole('spinbutton', { name: 'priority' });
    await user.type(priority, '5');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.plugins).toEqual({ 'limit-count': { count: 3, time_window: 60, _meta: { priority: 5 } } });
  });
});

describe('editing state ends with Save', () => {
  it('a secret revealed in a plugin form is masked in the locked view after Save, and on the next Edit', async () => {
    const { user, admin } = await openEditor('#/consumers/jo', { objects: { consumers: [{ username: 'jo', plugins: { 'key-auth': { key: 'secret-one' } } }] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'jo' });
    await user.keyboard('e');
    const card = await main().findByRole('group', { name: 'key-auth' });
    await user.click(within(card).getByRole('button', { name: 'key-auth' }));
    const key = within(card).getByLabelText(/^key\b(?!-)/);
    await user.clear(key);
    await user.type(key, 'secret-two');
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    expect(key).toHaveAttribute('type', 'text');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(screen.getByRole('main').textContent).not.toContain('secret-two');

    await user.keyboard('e');
    expect(within(main().getByRole('group', { name: 'key-auth' })).getByLabelText(/^key\b(?!-)/)).toHaveAttribute('type', 'password');
  });

  it('a blank map row added while editing is not in the locked view after Save', async () => {
    const { user, admin, card } = await editRoute({ 'kafka-logger': { broker_list: { '10.0.0.1': 9092 }, kafka_topic: 't' } }, 'kafka-logger');
    const brokers = within(within(card).getByRole('group', { name: /^broker_list/ }));
    await user.click(brokers.getByRole('button', { name: t('sf.map.add') }));
    await user.type(within(card).getByRole('textbox', { name: /^kafka_topic/ }), '2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    const locked = main().getByRole('group', { name: /^broker_list/ });
    expect(locked.querySelectorAll('.sf-map__row')).toHaveLength(1);
    expect(within(locked).getByText('10.0.0.1')).toBeInTheDocument();
  });
});

