// Codex final pass, X1: a stored value that holds a PEM private key is never shown by any scalar
// renderer of the schema form, locked or editing: not by a string enum's select (proxy-rewrite.method,
// which APISIX takes as `$env://…` text without checking the enum) nor by a number that also takes
// text (limit-count.count). Both say "Set, not shown", as the plain string field does; a key typed into
// the number-or-text box shows until the box is left. Saving an unrelated change sends the stored value.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { schemaOf } from '../test/pluginFixture';
import { pluginReplies } from '../test/plugins';
import { renderSchemaForm } from '../test/schemaForm';
import { getToasts } from '../ui/toast';

beforeAll(async () => {
  await import('../resources/routes/bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAscalarKeyBody';
const TYPED = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAtypedScalarKey';
const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\n${body}${'A'.repeat(100)}\n-----END PRIVATE KEY-----`;
// In the markup or in the text a reader gets.
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);

const COUNT: Obj = { count: pem(BODY), time_window: 60 };
// APISIX skips the check of a string starting with $env:// where the schema's type is string or none
// (apisix/secret.lua is_secret_ref), so neither enum is checked against it.
const METHOD: Obj = { uri: '/x', method: `$env://METHOD\n${pem(BODY)}` };
const VERSION: Obj = { http_version: `$env://VERSION\n${pem(BODY)}`, min_length: 20 };
/** Each case: the plugin, its stored config, the field holding the key, another field to type '1' into and what that emits. */
const CASES: [plugin: string, conf: Obj, field: string, other: () => HTMLElement, after: Obj][] = [
  ['limit-count', COUNT, 'count', () => screen.getByRole('textbox', { name: /^time_window/ }), { time_window: 601 }],
  ['proxy-rewrite', METHOD, 'method', () => screen.getByRole('textbox', { name: /^uri/ }), { uri: '/x1' }],
  // An enum of numbers with no type (the schema form's EnumField).
  ['gzip', VERSION, 'http_version', () => screen.getByRole('spinbutton', { name: /^min_length/ }), { min_length: 201 }],
];

describe.each(CASES)('%s: a stored private key', (plugin, conf, field, other, after) => {
  it.each([true, false])('locked %s: not in the page; the field says it is set, with no Show', (locked) => {
    renderSchemaForm(schemaOf(plugin), conf, { locked, baseline: conf, name: plugin });
    expect(inPage(BODY)).toBe(false);
    expect(screen.getByText(t('sf.secret.stored'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('sf.secret.show', { name: field }) })).toBeNull();
    cleanup();
  });

  it('editing, an unrelated change: the stored value is emitted unchanged, and still not shown', async () => {
    const form = renderSchemaForm(schemaOf(plugin), conf, { baseline: conf, name: plugin });
    await form.user.type(other(), '1');
    expect(form.value()).toEqual({ ...conf, ...after });
    expect(inPage(BODY)).toBe(false);
  });
});

describe('limit-count’s count (a number that also takes text)', () => {
  it('a key typed into it shows until the box is left; then it is hidden, and taken', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), { count: 5, time_window: 60 }, { baseline: { count: 5, time_window: 60 }, name: 'limit-count' });
    const box = screen.getByRole('textbox', { name: /^count/ });
    await form.user.clear(box);
    await form.user.paste(pem(TYPED).replace(/\n/g, ' '));
    expect(inPage(TYPED)).toBe(true);
    await form.user.click(screen.getByRole('textbox', { name: /^time_window/ }));
    await waitFor(() => expect(inPage(TYPED)).toBe(false));
    expect(screen.getByText(t('sf.secret.entered'))).toBeInTheDocument();
    expect((form.value() as Obj).count).toContain(TYPED);
    expect(form.held()).toEqual([]);
    // Keep the stored value puts the number back.
    await form.user.click(screen.getByRole('button', { name: t('sf.secret.keep') }));
    expect(form.value()).toEqual({ count: 5, time_window: 60 });
    expect(screen.getByRole('textbox', { name: /^count/ })).toHaveValue('5');
  });
});

describe('a route with all three, in the editor', () => {
  const ROUTE: Obj = {
    id: 'r1',
    name: 'keys',
    uri: '/k',
    plugins: { 'limit-count': COUNT, 'proxy-rewrite': METHOD, gzip: VERSION },
    upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] },
  };

  it('the Plugins tab never shows a key, locked or editing; saving another change sends each as stored', async () => {
    const { user, admin } = await openEditor('#/routes/r1?tab=plugins', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'keys' });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    for (const name of ['limit-count', 'proxy-rewrite', 'gzip']) {
      const card = main().getByRole('group', { name });
      await user.click(within(card).getByRole('button', { name }));
    }
    await waitFor(() => expect(main().getAllByText(t('sf.secret.stored'))).toHaveLength(3));
    expect(inPage(BODY)).toBe(false);

    await user.keyboard('e');
    await waitFor(() => expect(main().getAllByText(t('sf.secret.stored'))).toHaveLength(3));
    expect(inPage(BODY)).toBe(false);

    await user.click(main().getByRole('tab', { name: /^General/ }));
    await user.type(await main().findByRole('textbox', { name: t('rt.general.name') }), '2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'keys2', plugins: { 'limit-count': COUNT, 'proxy-rewrite': METHOD, gzip: VERSION } });
    expect(inPage(BODY)).toBe(false);
  });
});

// Fix round 1, Y1: a list row's card header sums up the row's first values; never one holding a key.
describe('a list row’s summary (response-rewrite filters, 3.20)', () => {
  const FILTERS: Obj = { filters: [{ regex: 'x', replace: pem(BODY) }] };

  it.each([true, false])('locked %s: a stored key in replace is not in the header, nor anywhere on the page', (locked) => {
    renderSchemaForm(schemaOf('response-rewrite'), FILTERS, { locked, baseline: FILTERS, name: 'response-rewrite' });
    expect(document.querySelector('.sf-card__summary')?.textContent).toBe('regex=x');
    expect(inPage(BODY)).toBe(false);
    cleanup();
  });

  it('a key typed into replace: in the header neither while typed nor once the field is left', async () => {
    const value: Obj = { filters: [{ regex: 'x', replace: 'y' }] };
    const form = renderSchemaForm(schemaOf('response-rewrite'), value, { baseline: value, name: 'response-rewrite' });
    const replace = screen.getByRole('textbox', { name: /^replace/ });
    await form.user.clear(replace);
    await form.user.paste(pem(TYPED).replace(/\n/g, ' '));
    expect(document.querySelector('.sf-card__summary')?.textContent).toBe('regex=x');
    await form.user.click(screen.getByRole('textbox', { name: /^regex/ }));
    await waitFor(() => expect(inPage(TYPED)).toBe(false));
    expect(document.querySelector('.sf-card__summary')?.textContent).toBe('regex=x');
    expect(((form.value() as Obj).filters as Obj[])[0]?.replace).toContain(TYPED);
  });

  it('a never-shown name (client_key) is left out of a summary too, where the item’s schema does not name it', () => {
    const schema: Obj = { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { host: { type: 'string' } } } } } };
    renderSchemaForm(schema, { list: [{ client_key: 'plain-text-key', host: 'h' }] }, { locked: true });
    expect(document.querySelector('.sf-card__summary')?.textContent).toBe('host=h');
  });
});

// Fix round 1, Y2: a key typed into a field that refuses it (a number-only field, a tag list whose
// items must be numbers) stays held once the field is left, but as the words for a key taken out of
// the page; the held message, which a refused Save shows, never quotes it.
describe('a key typed into a field that refuses it', () => {
  const MARKER = t('ssl.pem.marker');
  const line = pem(TYPED).replace(/\n/g, ' ');

  it('limit-count’s rejected_code (a number only): once left, not in the page nor in the held message; still held; emptied, nothing held', async () => {
    const form = renderSchemaForm(schemaOf('limit-count'), { count: 1, time_window: 60 }, { name: 'limit-count' });
    const box = screen.getByRole('spinbutton', { name: /^rejected_code/ });
    await form.user.click(box);
    await form.user.paste(line);
    expect(inPage(TYPED)).toBe(true);
    await form.user.click(screen.getByRole('textbox', { name: /^time_window/ }));
    expect(inPage(TYPED)).toBe(false);
    expect(box).toHaveValue(MARKER);
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: 'limit-count.rejected_code', text: MARKER })]);
    expect(form.value()).toEqual({ count: 1, time_window: 60 });
    await form.user.clear(box);
    expect(form.held()).toEqual([]);
  });

  it('a list of numbers: once left, not in the page nor in the held message; still held; emptied, nothing held', async () => {
    const schema: Obj = { type: 'object', properties: { statuses: { type: 'array', items: { type: 'integer', minimum: 500, maximum: 599 } } } };
    const form = renderSchemaForm(schema, { statuses: [500] }, { name: 'api-breaker' });
    const box = screen.getByRole('textbox', { name: /^statuses/ });
    await form.user.click(box);
    await form.user.paste(line);
    expect(inPage(TYPED)).toBe(true);
    await form.user.click(document.body);
    expect(inPage(TYPED)).toBe(false);
    expect(box).toHaveValue(MARKER);
    expect(form.held()).toEqual([t('ui.pending.tag', { field: 'api-breaker.statuses', text: MARKER, reason: t('ui.number.integer') })]);
    expect(form.value()).toEqual({ statuses: [500] });
    await form.user.clear(box);
    expect(form.held()).toEqual([]);
  });

  it('in the editor: Save is refused, its toast and every request free of the key', async () => {
    const ROUTE: Obj = { id: 'r1', name: 'keys', uri: '/k', plugins: { 'limit-count': { count: 1, time_window: 60 } }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
    const { user, admin } = await openEditor('#/routes/r1?tab=plugins', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'keys' });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    await user.click(main().getByRole('button', { name: t('editor.edit') }));
    const card = main().getByRole('group', { name: 'limit-count' });
    if (!within(card).queryByRole('spinbutton', { name: /^rejected_code/ })) await user.click(within(card).getByRole('button', { name: 'limit-count' }));
    const box = await within(card).findByRole('spinbutton', { name: /^rejected_code/ });
    await user.click(box);
    await user.paste(line);
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    expect(getToasts().at(-1)?.message).toContain(MARKER);
    expect(JSON.stringify(getToasts())).not.toContain(TYPED);
    expect(writesOf(admin)).toEqual([]);
    expect(inPage(TYPED)).toBe(false);
  });
});
