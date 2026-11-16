// Codex final pass, X3: a private key pasted into a value of a map shown as the key/value editor. The
// value then needs the rows (whose fields never show a key), but the key/value editor stays while the
// user is in it, without setting state as it renders (that looped: "Too many re-renders"); the rows
// take over when the field is left, starting from the editor's own rows, so another row's unfinished
// input is kept (final wave D3: a renderer switch never discards another row's edit).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { schemaOf } from '../test/pluginFixture';
import { renderSchemaForm } from '../test/schemaForm';

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapPastedKey';
// One line: what a single-line box keeps of a pasted PEM.
const KEY = `-----BEGIN PRIVATE KEY----- ${BODY}${'A'.repeat(100)} -----END PRIVATE KEY-----`;
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);
const group = (name: string) => within(screen.getByRole('group', { name: new RegExp(`^${name}`) }));

describe('a private key pasted into a map value (proxy-rewrite headers.set, 3.20)', () => {
  it('is taken with no render loop and shows while typed; once the map is left it is hidden, and a second row holding unfinished input keeps it', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { set: { 'X-A': 'a', 'X-B': 'b' } } }, { name: 'proxy-rewrite' });
    const field = 'proxy-rewrite.headers.set';
    // The second row holds unfinished input: its key cleared, its value kept.
    await form.user.clear(group('set').getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) }));
    const held = [t('ui.pending.noKey', { field, n: 2 })];
    expect(form.held()).toEqual(held);

    const value1 = group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) });
    await form.user.click(value1);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste(KEY);
    expect(value1).toHaveFocus();
    expect(value1).toHaveValue(KEY);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-B': 'b' } } });
    expect(form.held()).toEqual(held);

    // Left: the rows show the map, the key in words only; the second row is as it was, and still held.
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(BODY)).toBe(false));
    const rows = group('set');
    expect(rows.getByText(t('sf.secret.set'))).toBeInTheDocument();
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) })).toHaveValue('X-A');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) })).toHaveValue('');
    expect(rows.getByRole('textbox', { name: t('sf.map.valueOfEntry', { n: 2 }) })).toHaveValue('b');
    expect(form.held()).toEqual(held);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-B': 'b' } } });

    // The row is finished there: the map is the rows as shown.
    await form.user.type(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), 'X-C');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-C': 'b' } } });
    expect(inPage(BODY)).toBe(false);
  });

  it('with nothing else held: left, the rows take over with every entry, the key in words only', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { set: { 'X-A': 'a', 'X-B': 'b' } } }, { name: 'proxy-rewrite' });
    const value2 = group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 2 }) });
    await form.user.click(value2);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste(KEY);
    expect(inPage(BODY)).toBe(true);
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(BODY)).toBe(false));
    const rows = group('set');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) })).toHaveValue('X-A');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) })).toHaveValue('X-B');
    expect(rows.getByText(t('sf.secret.set'))).toBeInTheDocument();
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': 'a', 'X-B': KEY } } });
  });
});
