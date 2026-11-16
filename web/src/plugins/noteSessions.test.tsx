// Codex final pass, X2: a private-key note belongs to one editing session of one view (schema/keyNotes.ts
// rule 2). When the session ends (a save, Discard, a lock), a JSON view's text and notes are made again
// from the value, so a note of an earlier session resolves to nothing: key A, replaced by B and saved,
// can never come back through A's old note. The plugin card's JSON view and a schema-form JSON field,
// held to what the editor's JSON tab does, with the same probe.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { pluginReplies } from '../test/plugins';

beforeAll(async () => {
  await import('../resources/routes/bodies');
  await import('../ui/codemirror/CodeEditorImpl');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\n${body}${'A'.repeat(100)}\n-----END PRIVATE KEY-----`;
const KEY_A = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAsessionKeyA';
const KEY_B = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAsessionKeyB';
const CERT = `-----BEGIN CERTIFICATE-----\nMIIBclientcert${'B'.repeat(120)}\n-----END CERTIFICATE-----`;
const note = /•{8} private key [0-9a-z]{8}\.\d+, not shown/;
const NODES = { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] };

const split = (key: string, weight = 1): Obj => ({
  rules: [{ weighted_upstreams: [{ upstream: { type: 'roundrobin', scheme: 'https', nodes: { '10.0.0.9:443': 1 }, tls: { client_cert: CERT, client_key: key } }, weight }, { weight: 1 }] }],
});
const SPLIT: Obj = { id: 'r1', name: 'keys', uri: '/k', plugins: { 'traffic-split': split(pem(KEY_A)) }, upstream: NODES };
const VALIDATION: Obj = { id: 'r1', name: 'keys', uri: '/k', plugins: { 'request-validation': { body_schema: { k: pem(KEY_A), n: 1 } } }, upstream: NODES };

/** One editing JSON view: the route it edits, the box once shown, and the plugins a save sends with key `key` (and `n`, an ordinary value). */
interface View {
  name: string;
  route: Obj;
  hash: string;
  box: () => Promise<HTMLElement>;
  sent: (key: string, n: number) => Obj;
}

async function expand(user: UserEvent, plugin: string): Promise<HTMLElement> {
  const card = await main().findByRole('group', { name: plugin });
  await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
  if (!within(card).queryByRole('button', { name: t('pl.card.json') })) await user.click(within(card).getByRole('button', { name: plugin }));
  await within(card).findByRole('button', { name: t('pl.card.json') });
  return card;
}

const views = (user: () => UserEvent): View[] => [
  {
    name: 'the editor’s JSON tab',
    route: SPLIT,
    hash: '#/routes/r1?tab=json',
    box: () => screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) }),
    sent: (key, n) => ({ 'traffic-split': split(key, n) }),
  },
  {
    name: 'a plugin card’s JSON view',
    route: SPLIT,
    hash: '#/routes/r1?tab=plugins',
    box: async () => {
      const card = await expand(user(), 'traffic-split');
      if (within(card).queryByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'traffic-split' }) }) === null) {
        await user().click(within(card).getByRole('button', { name: t('pl.card.json') }));
      }
      return within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'traffic-split' }) });
    },
    sent: (key, n) => ({ 'traffic-split': split(key, n) }),
  },
  {
    name: 'a schema-form JSON field',
    route: VALIDATION,
    hash: '#/routes/r1?tab=plugins',
    box: async () => {
      const card = await expand(user(), 'request-validation');
      return within(card).findByRole('textbox', { name: t('sf.json.label', { key: 'body_schema' }) });
    },
    sent: (key, n) => ({ 'request-validation': { body_schema: { k: key, n } } }),
  },
];

async function replaceText(user: UserEvent, box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

/** The box's text, compact, once it shows a note. */
async function noted(box: HTMLElement): Promise<string> {
  await waitFor(() => expect(box.textContent).toMatch(note));
  return JSON.stringify(JSON.parse(box.textContent ?? ''));
}

const holder: { user?: UserEvent } = {};
const current = () => holder.user as UserEvent;

describe.each(views(current))('$name', (view) => {
  async function start() {
    const app = await openEditor(view.hash, { objects: { routes: [view.route] }, replies: pluginReplies() });
    holder.user = app.user;
    await main().findByRole('heading', { level: 1, name: 'keys' });
    await app.user.click(await main().findByRole('button', { name: t('editor.edit') }));
    return app;
  }

  async function save(user: UserEvent, admin: Parameters<typeof writesOf>[0], n: number) {
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(n));
    await main().findByRole('button', { name: t('editor.edit') });
  }

  it('key A’s note, after A was replaced by B and saved, is refused in the next session: an unknown note, nothing sent', async () => {
    const { user, admin } = await start();
    const first = await noted(await view.box());
    const token = note.exec(first)?.[0] ?? '';
    expect(token).not.toBe('');
    await replaceText(user, await view.box(), first.replace(JSON.stringify(token), JSON.stringify(pem(KEY_B))));
    await save(user, admin, 1);
    expect(writesOf(admin)[0]?.body).toMatchObject({ plugins: view.sent(pem(KEY_B), 1) });

    await user.click(main().getByRole('button', { name: t('editor.edit') }));
    const box = await view.box();
    const second = await noted(box);
    expect(second).not.toContain(token);
    // The probe: the first session's text, A's note at its own path.
    await replaceText(user, box, first);
    expect(await main().findByText(t('json.note.unknown'))).toBeInTheDocument();
    await user.keyboard('{Control>}s{/Control}');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(writesOf(admin)).toHaveLength(1);
    expect(JSON.stringify(admin.requests.map((r) => r.body ?? null))).not.toContain(KEY_A);
  });

  it('an ordinary edit, save, edit again, another edit, save: each sends the key as it stands', async () => {
    const { user, admin } = await start();
    const first = await noted(await view.box());
    await replaceText(user, await view.box(), first.replace('"weight":1', '"weight":2').replace('"n":1', '"n":2'));
    await save(user, admin, 1);
    expect(writesOf(admin)[0]?.body).toMatchObject({ plugins: view.sent(pem(KEY_A), 2) });

    await user.click(main().getByRole('button', { name: t('editor.edit') }));
    const second = await noted(await view.box());
    await replaceText(user, await view.box(), second.replace('"weight":2', '"weight":3').replace('"n":2', '"n":3'));
    await save(user, admin, 2);
    expect(writesOf(admin)[1]?.body).toMatchObject({ plugins: view.sent(pem(KEY_A), 3) });
  });
});
