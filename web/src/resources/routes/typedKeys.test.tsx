// Codex final pass, fix round 2, Z1: a private key typed or dropped into the route's URIs, hosts or
// client addresses is refused with a message that quotes what was refused; once the box is left the
// key is in no text of the page: not the box, not the field's error, not the refused Save's toast.
import { fireEvent, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAroutePathKey';
const KEY = `-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----`;
const MARKER = t('ssl.pem.marker');
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);
const ROUTE: Obj = { id: 'r1', name: 'keys', uri: '/k', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };

const FIELDS: [name: string, label: () => string][] = [
  ['URIs', () => `${t('rt.match.uris')} (${t('ui.required')})`],
  ['hosts', () => t('rt.match.hosts')],
  ['client addresses', () => t('rt.match.addrs')],
];
const ENTRIES: [how: string, enter: (user: UserEvent, box: HTMLElement) => Promise<void>][] = [
  ['typed', (user, box) => user.type(box, KEY)],
  ['dropped', async (user, box) => {
    await user.click(box);
    fireEvent.change(box, { target: { value: KEY } });
  }],
];

describe.each(FIELDS)('the route’s %s', (_name, label) => {
  it.each(ENTRIES)('a key %s, then left: in no text of the page; Save refused, its toast and the requests free of it', async (_how, enter) => {
    const { user, admin } = await openEditor('#/routes/r1?tab=matching', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'keys' });
    await user.click(main().getByRole('button', { name: t('editor.edit') }));
    const box = await main().findByRole('textbox', { name: label() });
    await enter(user, box);
    await user.click(main().getByRole('heading', { level: 1, name: 'keys' }));
    expect(inPage(BODY)).toBe(false);
    expect(box).toHaveValue(MARKER);
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    expect(getToasts().at(-1)?.message).toContain(MARKER);
    expect(JSON.stringify(getToasts())).not.toContain(BODY);
    expect(writesOf(admin)).toEqual([]);
    expect(inPage(BODY)).toBe(false);
  });
});
