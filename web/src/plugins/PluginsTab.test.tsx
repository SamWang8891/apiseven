import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { json } from '../test/fakeAdmin';
import { renderPluginsTab } from '../test/plugins';
import { editableControls } from '../test/schemaForm';

/** The card of plugin `name`, once the plugin list has loaded. */
async function card(name: string) {
  const el = await screen.findByRole('group', { name });
  await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
  return el;
}
/** The card's open/close button (named after the plugin). */
const toggle = (el: HTMLElement, name: string) => within(el).getByRole('button', { name });

async function openPicker(user: ReturnType<typeof renderPluginsTab>['user']) {
  await user.click(await screen.findByRole('button', { name: t('pl.add') }));
  return screen.findByRole('dialog', { name: t('pl.picker.title') });
}

/** Replaces a CodeMirror editor's text: select all, then paste (typing `{` would be auto-closed). */
async function replaceCode(user: ReturnType<typeof renderPluginsTab>['user'], box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

describe('adding a plugin', () => {
  it('limit-count from the picker: a card with an empty form and a required-field error on count; count and time_window clear it', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route' });
    const dialog = await openPicker(user);
    await user.type(within(dialog).getByRole('combobox', { name: t('pl.picker.search') }), 'limit-count');
    await user.click(within(dialog).getByRole('option', { name: /^limit-count\b/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(value()).toEqual({ 'limit-count': {} });

    const el = await card('limit-count');
    expect(toggle(el, 'limit-count')).toHaveAttribute('aria-expanded', 'true');
    const count = within(el).getByRole('textbox', { name: 'count (required)' });
    expect(count).toHaveValue('');
    expect(count).toHaveAccessibleDescription(t('schema.required'));
    expect(within(el).getByText(t('pl.card.problems.many', { count: 2 }))).toBeInTheDocument();

    await user.type(count, '2');
    await user.type(within(el).getByRole('textbox', { name: 'time_window (required)' }), '60');
    expect(value()).toEqual({ 'limit-count': { count: 2, time_window: 60 } });
    expect(within(el).getByRole('textbox', { name: 'count (required)' })).not.toHaveAccessibleDescription(t('schema.required'));
    expect(within(el).queryByText(/problems?$/)).not.toBeInTheDocument();
  });

  it('emits { ...existing, name: {} } and opens only the new card', async () => {
    const { user, changes } = renderPluginsTab({ scope: 'route', value: { cors: { allow_origins: '*' } } });
    expect(toggle(await card('cors'), 'cors')).toHaveAttribute('aria-expanded', 'false');
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByRole('option', { name: /^key-auth\b/ }));
    expect(changes).toHaveBeenLastCalledWith({ cors: { allow_origins: '*' }, 'key-auth': {} });
    expect(toggle(await card('key-auth'), 'key-auth')).toHaveAttribute('aria-expanded', 'true');
    expect(toggle(await card('cors'), 'cors')).toHaveAttribute('aria-expanded', 'false');
  });

  it('the picker groups by category, marks configured plugins as added and picks with the keyboard', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { 'limit-count': { count: 1, time_window: 1 } } });
    const dialog = await openPicker(user);
    const search = within(dialog).getByRole('combobox', { name: t('pl.picker.search') });
    expect(search).toHaveFocus();
    const traffic = within(dialog).getByRole('group', { name: t('pl.category.traffic') });
    expect(within(traffic).getByRole('option', { name: /^limit-count\b/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(traffic).getByRole('option', { name: /^limit-count\b/ })).toHaveTextContent(t('pl.picker.added'));
    // Plugins the docs catalog does not list fall under Other.
    expect(within(within(dialog).getByRole('group', { name: t('pl.category.other') })).getByRole('option', { name: /^example-plugin\b/ })).toBeInTheDocument();
    // A description matches too.
    await user.type(search, 'sliding window');
    expect(within(dialog).getAllByRole('option').map((o) => o.getAttribute('data-plugin'))).toEqual(['limit-count']);
    await user.clear(search);
    await user.type(search, 'zzz-nothing');
    expect(within(dialog).getByText(t('pl.picker.none', { query: 'zzz-nothing' }))).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'proxy-rew');
    await user.keyboard('{Enter}');
    expect(value()).toEqual({ 'limit-count': { count: 1, time_window: 1 }, 'proxy-rewrite': {} });
  });

  it('Enter takes the best name match, not the first row: "limit" adds limit-conn, not ai-rate-limiting', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route' });
    const dialog = await openPicker(user);
    await user.type(within(dialog).getByRole('combobox', { name: t('pl.picker.search') }), 'limit');
    expect(within(dialog).getAllByRole('option')[0]).toHaveAttribute('data-plugin', 'ai-rate-limiting');
    expect(within(dialog).getByRole('option', { selected: true })).toHaveAttribute('data-plugin', 'limit-conn');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(value()).toEqual({ 'limit-count': {} });
  });

  it('is not offered while locked', async () => {
    renderPluginsTab({ scope: 'route', value: { cors: {} }, locked: true });
    await card('cors');
    expect(screen.queryByRole('button', { name: t('pl.add') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove cors' })).not.toBeInTheDocument();
  });

  it('a stream route offers stream plugins only', async () => {
    const { user } = renderPluginsTab({ scope: 'stream_route' });
    const dialog = await openPicker(user);
    const names = within(dialog).getAllByRole('option').map((o) => o.getAttribute('data-plugin'));
    expect(names.sort()).toEqual(['ip-restriction', 'limit-conn', 'mqtt-proxy', 'syslog', 'traffic-split']);
    expect(within(dialog).queryByRole('option', { name: /^proxy-rewrite\b/ })).not.toBeInTheDocument();
  });

  it('a credential offers auth plugins with a consumer schema, and holds one', async () => {
    const { user } = renderPluginsTab({ scope: 'credential' });
    const dialog = await openPicker(user);
    const names = within(dialog).getAllByRole('option').map((o) => o.getAttribute('data-plugin'));
    expect(names.sort()).toEqual(['basic-auth', 'hmac-auth', 'jwe-decrypt', 'jwt-auth', 'key-auth', 'ldap-auth', 'ldap-auth-advanced', 'wolf-rbac']);
    await user.click(within(dialog).getByRole('option', { name: /^key-auth\b/ }));
    await card('key-auth');
    expect(screen.queryByRole('button', { name: t('pl.add') })).not.toBeInTheDocument();
    expect(screen.getByText(t('pl.credentialOne'))).toBeInTheDocument();
  });
});

describe('removing a plugin', () => {
  it('the last one on a route leaves no plugins at all', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { cors: {}, 'key-auth': {} } });
    await user.click(within(await card('cors')).getByRole('button', { name: 'Remove cors' }));
    expect(value()).toEqual({ 'key-auth': {} });
    await user.click(within(await card('key-auth')).getByRole('button', { name: 'Remove key-auth' }));
    expect(value()).toBeUndefined();
    expect(screen.getByText(t('pl.empty'))).toBeInTheDocument();
  });

  it.each(['global_rule', 'plugin_config'] as const)('the last one on a %s leaves {} (APISIX requires plugins there)', async (scope) => {
    const { user, value } = renderPluginsTab({ scope, value: { cors: {} } });
    await user.click(within(await card('cors')).getByRole('button', { name: 'Remove cors' }));
    expect(value()).toEqual({});
  });
});

describe('the on/off switch', () => {
  it('off writes _meta.disable: true; on removes it, and _meta with it when nothing else is there', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { cors: { allow_origins: '*' } } });
    const el = await card('cors');
    const sw = within(el).getByRole('switch', { name: t('pl.card.enable', { name: 'cors' }) });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(value()).toEqual({ cors: { _meta: { disable: true }, allow_origins: '*' } });
    expect(within(el).getByRole('switch', { name: t('pl.card.enable', { name: 'cors' }) })).not.toBeChecked();
    await user.click(sw);
    expect(value()).toEqual({ cors: { allow_origins: '*' } });
  });

  it('keeps the other _meta keys', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { cors: { _meta: { priority: 5 } } } });
    const sw = within(await card('cors')).getByRole('switch', { name: t('pl.card.enable', { name: 'cors' }) });
    await user.click(sw);
    expect(value()).toEqual({ cors: { _meta: { priority: 5, disable: true } } });
    await user.click(sw);
    expect(value()).toEqual({ cors: { _meta: { priority: 5 } } });
  });

  it('locked: reads On / Off as text', async () => {
    renderPluginsTab({ scope: 'route', value: { cors: { _meta: { disable: true } } }, locked: true });
    const el = await card('cors');
    expect(within(el).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(el).getByText(t('ui.off'))).toBeInTheDocument();
  });
});

describe('Form and JSON', () => {
  it('the JSON tab shows the same value, and editing the JSON updates the form', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { 'limit-count': { count: 2, time_window: 60 } } });
    const el = await card('limit-count');
    await user.click(toggle(el, 'limit-count'));
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    expect(box.textContent).toContain('"count": 2');
    await replaceCode(user, box, '{"count": 7, "time_window": 60, "rejected_code": 429}');
    expect(value()).toEqual({ 'limit-count': { count: 7, time_window: 60, rejected_code: 429 } });
    await user.click(within(el).getByRole('button', { name: t('pl.card.form') }));
    expect(within(el).getByRole('textbox', { name: 'count (required)' })).toHaveValue('7');
  });

  it('a schema with a pattern JavaScript cannot read: no issue from it, and a quiet note in the JSON view (Task 16 B18)', async () => {
    // openwhisk (3.20) checks action, namespace and package with PCRE's \A…\z.
    const conf = { api_host: 'http://ow.test', service_token: 'u:p', namespace: 'guest', action: 'hello world' };
    const { user, value } = renderPluginsTab({ scope: 'route', value: { openwhisk: conf } });
    const el = await card('openwhisk');
    expect(within(el).queryByText(t('pl.card.problems.one'))).not.toBeInTheDocument();
    await user.click(toggle(el, 'openwhisk'));
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const note = t('sf.gaps.some', { parts: t('sf.gaps.patterns') });
    expect(await within(el).findByText(note)).toBeInTheDocument();
    expect(value()).toEqual({ openwhisk: conf });
    // The note belongs to the JSON view: the Form view of the same plugin has none.
    await user.click(within(el).getByRole('button', { name: t('pl.card.form') }));
    expect(within(el).queryByText(note)).not.toBeInTheDocument();
  });

  it('a schema with formats the browser does not check: the note names them (Task 16b, item 153)', async () => {
    const conf = { allowlist: ['10.0.0.1'] };
    const { user } = renderPluginsTab({ scope: 'route', value: { 'ip-restriction': conf } });
    const el = await card('ip-restriction');
    await user.click(toggle(el, 'ip-restriction'));
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    expect(await within(el).findByText(t('sf.gaps.some', { parts: t('sf.gaps.formats', { formats: 'ipv4, ipv6' }) }))).toBeInTheDocument();
  });

  it('JSON that does not parse, or is not an object, is not emitted', async () => {
    const { user, changes } = renderPluginsTab({ scope: 'route', value: { cors: {} } });
    const el = await card('cors');
    await user.click(toggle(el, 'cors'));
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'cors' }) });
    await replaceCode(user, box, '{"allow_origins": ');
    expect(within(el).getByText(/^Not valid JSON/)).toBeInTheDocument();
    await replaceCode(user, box, '[1]');
    expect(within(el).getByText(t('pl.card.notObject'))).toBeInTheDocument();
    expect(changes).not.toHaveBeenCalled();
  });

  it('a form edit keeps a key the schema does not know, and _meta', async () => {
    const { user, value } = renderPluginsTab({ scope: 'route', value: { cors: { _meta: { priority: 3 }, x_custom: { a: [1] }, max_age: 5 } }, validate: false });
    const el = await card('cors');
    await user.click(toggle(el, 'cors'));
    // _meta is not part of the form: it is not named as a field the schema lacks.
    expect(within(el).getByText(t('sf.unknown.one', { keys: 'x_custom' }))).toBeInTheDocument();
    const maxAge = within(el).getByRole('spinbutton', { name: 'max_age' });
    await user.clear(maxAge);
    await user.type(maxAge, '9');
    expect(value()).toEqual({ cors: { _meta: { priority: 3 }, x_custom: { a: [1] }, max_age: 9 } });
  });

  it('consumer scope gives key-auth its consumer form: a secret key, required', async () => {
    const { user } = renderPluginsTab({ scope: 'consumer', value: { 'key-auth': {} } });
    const el = await card('key-auth');
    await user.click(toggle(el, 'key-auth'));
    const key = within(el).getByLabelText(/^key\b(?!-)/);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toBeRequired();
    // The route-side fields are not there.
    expect(within(el).queryByRole('textbox', { name: 'header' })).not.toBeInTheDocument();
  });
});

describe('_meta', () => {
  async function openMeta(scope: 'route' | 'consumer' | 'stream_route', value: Record<string, Record<string, unknown>>) {
    const harness = renderPluginsTab({ scope, value, validate: false });
    const name = Object.keys(value)[0] ?? '';
    const el = await card(name);
    await harness.user.click(toggle(el, name));
    await harness.user.click(within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    return { ...harness, el };
  }

  it('priority round-trips as a number, with the default priority as placeholder', async () => {
    const { user, value, el } = await openMeta('route', { 'limit-count': { count: 1, time_window: 1 } });
    const priority = within(el).getByRole('spinbutton', { name: 'priority' });
    expect(priority).toHaveAttribute('placeholder', t('pl.meta.priorityDefault', { priority: 1002 }));
    await user.type(priority, '-20');
    expect(value()).toEqual({ 'limit-count': { _meta: { priority: -20 }, count: 1, time_window: 1 } });
    await user.clear(priority);
    expect(value()).toEqual({ 'limit-count': { count: 1, time_window: 1 } });
  });

  it('filter: a JSON array is emitted, text that does not parse is not', async () => {
    const { user, value, changes, el } = await openMeta('route', { cors: {} });
    const box = await within(el).findByRole('textbox', { name: t('pl.meta.filterLabel') });
    await replaceCode(user, box, '[["arg_version", "==", "v2"]]');
    expect(value()).toEqual({ cors: { _meta: { filter: [['arg_version', '==', 'v2']] } } });
    const calls = changes.mock.calls.length;
    await replaceCode(user, box, '[["arg_version", "==",');
    expect(changes.mock.calls.length).toBe(calls);
    expect(within(el).getByText(/^Not valid JSON/)).toBeInTheDocument();
    await replaceCode(user, box, '{"a": 1}');
    expect(changes.mock.calls.length).toBe(calls);
    expect(within(el).getByText(t('pl.meta.filterNotArray'))).toBeInTheDocument();
  });

  it('disable in _meta is the header switch', async () => {
    const { user, value, el } = await openMeta('route', { cors: {} });
    await user.click(within(el).getByRole('switch', { name: 'disable' }));
    expect(value()).toEqual({ cors: { _meta: { disable: true } } });
    expect(within(el).getByRole('switch', { name: t('pl.card.enable', { name: 'cors' }) })).not.toBeChecked();
  });

  it('error_response: offered for auth plugins, as text or a JSON object', async () => {
    const { user, value, el } = await openMeta('route', { 'key-auth': {} });
    await user.type(within(el).getByRole('textbox', { name: 'error_response' }), 'Missing credential');
    expect(value()).toEqual({ 'key-auth': { _meta: { error_response: 'Missing credential' } } });
  });

  it('error_response: offered for any plugin on an HTTP request, since APISIX sends it whenever a plugin rejects one (known item 6)', async () => {
    const { user, value, el } = await openMeta('route', { 'limit-count': { count: 1, time_window: 1 } });
    await user.type(within(el).getByRole('textbox', { name: 'error_response' }), 'Slow down');
    expect(value()).toEqual({ 'limit-count': { _meta: { error_response: 'Slow down' }, count: 1, time_window: 1 } });
  });

  it('error_response: not offered where APISIX never sends it, a stream route or a consumer\'s sign-in plugin', async () => {
    const stream = await openMeta('stream_route', { 'limit-conn': { conn: 1, burst: 0, default_conn_delay: 0.1, key: 'remote_addr' } });
    expect(within(stream.el).queryByRole('textbox', { name: 'error_response' })).not.toBeInTheDocument();
    stream.unmount();
    const consumer = await openMeta('consumer', { 'limit-count': { count: 1, time_window: 1 } });
    expect(within(consumer.el).getByRole('textbox', { name: 'error_response' })).toBeInTheDocument();
    consumer.unmount();
    const signIn = await openMeta('consumer', { 'key-auth': { key: 'k' } });
    expect(within(signIn.el).queryByRole('textbox', { name: 'error_response' })).not.toBeInTheDocument();
  });

  it('error_response: switching between text and JSON converts the value ({"message": text})', async () => {
    const { user, value, el } = await openMeta('route', { 'key-auth': { _meta: { error_response: 'Denied' } } });
    await user.click(within(el).getByRole('combobox', { name: t('pl.meta.errorKind') }));
    await user.click(screen.getByRole('option', { name: t('pl.meta.errorJson') }));
    expect(value()).toEqual({ 'key-auth': { _meta: { error_response: { message: 'Denied' } } } });
    expect(await within(el).findByRole('textbox', { name: t('pl.meta.errorJsonLabel') })).toBeInTheDocument();
    await user.click(within(el).getByRole('combobox', { name: t('pl.meta.errorKind') }));
    await user.click(screen.getByRole('option', { name: t('pl.meta.errorText') }));
    expect(value()).toEqual({ 'key-auth': { _meta: { error_response: 'Denied' } } });
  });

  it('a stored error_response always shows; where APISIX ignores it a line says so (fix round 1, R4.4)', async () => {
    const http = await openMeta('route', { 'limit-count': { count: 1, time_window: 1, _meta: { error_response: 'Slow down' } } });
    expect(within(http.el).getByRole('textbox', { name: 'error_response' })).toHaveValue('Slow down');
    expect(within(http.el).getByRole('textbox', { name: 'error_response' })).toHaveAccessibleDescription(t('pl.meta.errorHelp'));
    expect(within(http.el).queryByText(t('pl.meta.errorIgnored.stream'))).not.toBeInTheDocument();
    expect(within(http.el).queryByText(t('pl.meta.errorIgnored.signIn'))).not.toBeInTheDocument();
    http.unmount();
    const stream = await openMeta('stream_route', { 'limit-conn': { conn: 1, burst: 0, default_conn_delay: 0.1, key: 'remote_addr', _meta: { error_response: 'closed' } } });
    expect(within(stream.el).getByRole('textbox', { name: 'error_response' })).toHaveValue('closed');
    expect(within(stream.el).getByText(t('pl.meta.errorIgnored.stream'))).toBeInTheDocument();
    // Task 16b item 165: the field's help follows the scope: it never says the body is sent where it is ignored.
    expect(within(stream.el).getByRole('textbox', { name: 'error_response' })).toHaveAccessibleDescription(t('pl.meta.errorIgnored.stream'));
    expect(within(stream.el).queryByText(t('pl.meta.errorHelp'))).not.toBeInTheDocument();
    stream.unmount();
    const signIn = await openMeta('consumer', { 'key-auth': { key: 'k', _meta: { error_response: 'who are you' } } });
    expect(within(signIn.el).getByRole('textbox', { name: 'error_response' })).toHaveValue('who are you');
    expect(within(signIn.el).getByText(t('pl.meta.errorIgnored.signIn'))).toBeInTheDocument();
    expect(within(signIn.el).getByRole('textbox', { name: 'error_response' })).toHaveAccessibleDescription(t('pl.meta.errorIgnored.signIn'));
    expect(within(signIn.el).queryByText(t('pl.meta.errorHelp'))).not.toBeInTheDocument();
  });

  it('pre_function and unknown keys are kept and named', async () => {
    const { el } = await openMeta('route', { cors: { _meta: { pre_function: 'return function() end', x: 1 } } });
    expect(within(el).getByText(t('pl.meta.other', { keys: 'pre_function, x' }))).toBeInTheDocument();
  });
});

describe('issues', () => {
  it('a card with issues shows their count, and opens when Save is attempted', async () => {
    const { update } = renderPluginsTab({ scope: 'route', value: { 'limit-count': {}, cors: {} } });
    const el = await card('limit-count');
    expect(toggle(el, 'limit-count')).toHaveAttribute('aria-expanded', 'false');
    expect(within(el).getByText(t('pl.card.problems.many', { count: 2 }))).toBeInTheDocument();
    update({ saveAttempts: 1 });
    await waitFor(() => expect(toggle(el, 'limit-count')).toHaveAttribute('aria-expanded', 'true'));
    expect(toggle(await card('cors'), 'cors')).toHaveAttribute('aria-expanded', 'false');
  });

  it("APISIX's error about a plugin shows on its card", async () => {
    const message = 'failed to check the configuration of plugin cors err: boom';
    const { user } = renderPluginsTab({ scope: 'route', value: { cors: {} }, extraIssues: [{ path: 'plugins.cors', message }] });
    const el = await card('cors');
    expect(within(el).getByText(t('pl.card.problems.one'))).toBeInTheDocument();
    await user.click(toggle(el, 'cors'));
    expect(within(el).getByText(message)).toBeInTheDocument();
  });

  it('a plugin this APISIX has not loaded: the issue, and JSON instead of a form', async () => {
    const { user } = renderPluginsTab({ scope: 'route', value: { 'my-plugin': { a: 1 } } });
    const el = await card('my-plugin');
    await user.click(toggle(el, 'my-plugin'));
    expect(within(el).getByText(t('pl.issue.unknown'))).toBeInTheDocument();
    expect(within(el).getByText(t('pl.card.noForm', { name: 'my-plugin' }))).toBeInTheDocument();
    expect(await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'my-plugin' }) })).toBeInTheDocument();
  });

  it('a plugin this APISIX has not loaded, locked: no summary and every value masked (which are secret is not known), revealable', async () => {
    const { user } = renderPluginsTab({ scope: 'route', locked: true, value: { 'my-logger': { endpoint: 'https://log.example', auth_header: 'Bearer zz9', port: 4433 } } });
    const el = await card('my-logger');
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    expect(el.querySelector('.pl-card__summary')?.textContent).toBe('');
    await user.click(toggle(el, 'my-logger'));
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'my-logger' }) });
    expect(document.body.innerHTML).not.toMatch(/Bearer zz9|log\.example|4433/);
    await user.click(within(el).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(box.textContent).toContain('Bearer zz9');
  });

  it('the plugin list failing to load leaves the configs editable as JSON', async () => {
    const { user } = renderPluginsTab({ scope: 'route', value: { cors: {} }, admin: { replies: { plugins: () => json(503, { error_msg: 'down' }) } } });
    expect(await screen.findByText(/Couldn't load the plugin list/)).toBeInTheDocument();
    const el = await card('cors');
    await user.click(toggle(el, 'cors'));
    expect(await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'cors' }) })).toBeInTheDocument();
  });
});

describe('the card header', () => {
  it('name, category, summary and a docs link that opens in a new tab', async () => {
    renderPluginsTab({ scope: 'route', value: { 'limit-count': { count: 2, time_window: 60, rejected_code: 429 } } });
    const el = await card('limit-count');
    expect(within(el).getByText('Traffic')).toBeInTheDocument();
    expect(within(el).getByText('count=2, time_window=60, rejected_code=429')).toBeInTheDocument();
    const docs = within(el).getByRole('link', { name: t('pl.card.docs', { name: 'limit-count' }) });
    expect(docs).toHaveAttribute('href', 'https://apisix.apache.org/docs/apisix/plugins/limit-count/');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noreferrer');
  });

  it('cards are sorted by name and collapsed by default', async () => {
    renderPluginsTab({ scope: 'route', value: { zipkin: {}, cors: {}, 'key-auth': {} } });
    await card('cors');
    const names = screen.getAllByRole('group').filter((g) => g.classList.contains('pl-card')).map((g) => g.getAttribute('aria-label') ?? g.textContent);
    expect(names).toHaveLength(3);
    const order = ['cors', 'key-auth', 'zipkin'].map((n) => screen.getByRole('group', { name: n }));
    expect(order[0]?.compareDocumentPosition(order[1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order[1]?.compareDocumentPosition(order[2] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const n of ['cors', 'key-auth', 'zipkin']) expect(toggle(screen.getByRole('group', { name: n }), n)).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no summary until the plugin list says which fields are secret', async () => {
    renderPluginsTab({
      scope: 'consumer',
      value: { 'key-auth': { key: 'super-secret-key' } },
      locked: true,
      admin: { replies: { plugins: () => new Promise<Response | undefined>(() => {}) } },
    });
    const el = await screen.findByRole('group', { name: 'key-auth' });
    expect(screen.getByText(t('pl.loading'))).toBeInTheDocument();
    expect(el.textContent).not.toContain('super-secret-key');
  });

  it('a secret never shows in the summary', async () => {
    renderPluginsTab({ scope: 'consumer', value: { 'key-auth': { key: 'super-secret-key' } }, locked: true });
    const el = await card('key-auth');
    expect(el.textContent).not.toContain('super-secret-key');
  });
});

describe('locked', () => {
  it('cards still open; nothing takes input; secrets masked in the form and in the JSON', async () => {
    const { user, container } = renderPluginsTab({
      scope: 'consumer',
      value: { 'key-auth': { key: 'super-secret-key' }, 'limit-count': { count: 2, time_window: 60, _meta: { priority: 3 } } },
      locked: true,
    });
    const ka = await card('key-auth');
    await user.click(toggle(ka, 'key-auth'));
    expect(ka.textContent).not.toContain('super-secret-key');
    await user.click(within(ka).getByRole('button', { name: t('pl.card.json') }));
    expect(ka.textContent).not.toContain('super-secret-key');
    await user.click(within(ka).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(ka.textContent).toContain('super-secret-key');

    const lc = await card('limit-count');
    await user.click(toggle(lc, 'limit-count'));
    await user.click(within(lc).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    expect(within(lc).getByText('3')).toBeInTheDocument();
    expect(editableControls(container).filter((el) => !el.closest('.cm-editor'))).toEqual([]);
  });
});

describe('inherited plugins', () => {
  it('list their origin and off state, say when this object overrides one, and are not editable', async () => {
    renderPluginsTab({
      scope: 'route',
      value: { cors: {} },
      inherited: [
        { name: 'cors', from: 'service', disabled: false },
        { name: 'key-auth', from: 'plugin_config', disabled: true },
      ],
    });
    const list = await screen.findByRole('list', { name: t('pl.inherited.title') });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('cors');
    expect(rows[0]).toHaveTextContent(t('pl.inherited.fromService'));
    expect(rows[0]).toHaveTextContent(t('pl.inherited.overridden'));
    expect(rows[1]).toHaveTextContent('key-auth');
    expect(rows[1]).toHaveTextContent(t('pl.inherited.fromPluginConfig'));
    expect(rows[1]).toHaveTextContent(t('pl.inherited.off'));
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(within(list).queryByRole('switch')).not.toBeInTheDocument();
  });
});
