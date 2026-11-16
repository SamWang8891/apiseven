// Final wave fix round 1, F2 / R1: a value that holds a PEM private-key block is never shown and never
// copied, whatever field it is in and whatever the lock state. Forms say "Set, not shown" with Replace;
// every JSON view shows a note (schema/keyNotes.ts) while editing and a mask while locked; Copy leaves
// the key out and says so. A key typed or pasted shows in its control until the control is left.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { analyze, type Node } from '../schema-form/analyze';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { everySchema, pluginFixture } from '../test/pluginFixture';
import { pluginReplies } from '../test/plugins';
import { renderSchemaForm } from '../test/schemaForm';
import { getToasts } from '../ui/toast';
import { ViewJsonDialog } from '../pages/RowActions';
import { renderWithProviders } from '../test/providers';
import { redactObject } from './secrets';

beforeAll(async () => {
  await import('../resources/routes/bodies');
  await import('../ui/codemirror/CodeEditorImpl');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

// Long enough for APISIX's schemas (private_key_schema, certificate_scheme: minLength 128).
const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\n${body}${'A'.repeat(100)}\n-----END PRIVATE KEY-----`;
const STORED = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAStoredKeyBody';
const NEW = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAnewKeyBody';
const CERT = `-----BEGIN CERTIFICATE-----\nMIIBclientcert${'B'.repeat(120)}\n-----END CERTIFICATE-----`;
const split = (key: string): Obj => ({
  rules: [{ weighted_upstreams: [{ upstream: { type: 'roundrobin', scheme: 'https', nodes: { '10.0.0.9:443': 1 }, tls: { client_cert: CERT, client_key: key } }, weight: 1 }, { weight: 1 }] }],
});
const ROUTE: Obj = { id: 'r1', name: 'split', uri: '/s', plugins: { 'traffic-split': split(pem(STORED)) }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
// In the markup or in the text a reader gets (CodeMirror can split a token over several elements).
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);
const note = /•{8} private key [0-9a-z]{8}\.\d+, not shown/;

async function open(hash = '#/routes/r1?tab=plugins', route: Obj = ROUTE) {
  const app = await openEditor(hash, { objects: { routes: [route] }, replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: String(route.name) });
  return app;
}

async function replaceText(user: UserEvent, box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

const jsonTab = () => screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });

describe('the reviewer’s sequences: after Edit, no JSON view shows the stored key', () => {
  it('e, then the card’s JSON view: a note in its place', async () => {
    const { user } = await open();
    const card = await main().findByRole('group', { name: 'traffic-split' });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    await user.keyboard('e');
    await user.click(within(card).getByRole('button', { name: 'traffic-split' }));
    await user.click(await within(card).findByRole('button', { name: t('pl.card.json') }));
    const box = await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'traffic-split' }) });
    await waitFor(() => expect(box.textContent).toMatch(note));
    expect(inPage(STORED)).toBe(false);
  });

  it('e, then the JSON tab: a note in its place; Copy leaves the key out and says so', async () => {
    const { user } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    expect(inPage(STORED)).toBe(false);
    await user.click(main().getByRole('button', { name: t('json.copy') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('json.copiedNoKey')));
    expect(await navigator.clipboard.readText()).not.toContain(STORED);
  });
});

describe('saving through the JSON views keeps or replaces the key as the note says', () => {
  it('an unrelated change saved through the JSON tab sends the stored key', async () => {
    const { user, admin } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const shown = JSON.parse(box.textContent?.replace(/\s+/g, ' ') ?? '{}') as Obj;
    await replaceText(user, box, JSON.stringify({ ...shown, name: 'split2' }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'split2', plugins: { 'traffic-split': split(pem(STORED)) } });
  });

  it('the note replaced by a new key sends the new key; a damaged note is refused and nothing is sent', async () => {
    const { user, admin } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const text = JSON.stringify(JSON.parse(box.textContent ?? '{}'));
    const token = note.exec(text)?.[0] ?? '';
    await replaceText(user, box, text.replace(token, token.replace('•••', '')));
    expect(await main().findByText(t('json.note.unknown'))).toBeInTheDocument();
    await user.keyboard('{Control>}s{/Control}');
    expect(writesOf(admin)).toEqual([]);
    await replaceText(user, box, text.replace(token, pem(NEW).replace(/\n/g, '\\n')));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ plugins: { 'traffic-split': split(pem(NEW)) } });
  });

  it('a key pasted into the JSON tab shows while it is typed, and is a note once the editor is left', async () => {
    const { user } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const text = JSON.parse(box.textContent ?? '{}') as Obj;
    await replaceText(user, box, JSON.stringify({ ...text, desc: pem(NEW) }));
    expect(inPage(NEW)).toBe(true);
    await user.click(main().getByRole('heading', { level: 1, name: 'split' }));
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    expect(box.textContent?.match(new RegExp(note.source, 'g'))).toHaveLength(2);
  });
});

describe('the form: "Set, not shown" with Replace', () => {
  it('Replace through the form: the new key shows while typed, is hidden once the box is left, and is sent; locked, "Set, not shown"', async () => {
    const { user, admin } = await open();
    const card = await main().findByRole('group', { name: 'traffic-split' });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    await user.click(within(card).getByRole('button', { name: 'traffic-split' }));
    await user.keyboard('e');
    await user.click(await within(card).findByRole('button', { name: t('sf.secret.replace', { name: 'client_key' }) }));
    const box = within(card).getByRole('textbox', { name: /^client_key/ });
    await user.click(box);
    await user.paste(pem(NEW));
    expect(inPage(NEW)).toBe(true);
    await user.click(main().getByRole('heading', { level: 1, name: 'split' }));
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    expect(within(card).getByText(t('sf.secret.set'))).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ plugins: { 'traffic-split': split(pem(NEW)) } });
    await main().findByRole('button', { name: t('editor.edit') });
    expect(within(card).getByText(t('sf.secret.stored'))).toBeInTheDocument();
    expect(inPage(NEW)).toBe(false);
  });
});

describe('View JSON and the lists: never shown, "Show secrets" included', () => {
  const SAML = { id: 'r2', name: 'saml', uri: '/x', plugins: { 'saml-auth': { sp_issuer: 'i', idp_uri: 'https://idp', idp_cert: CERT, login_callback_uri: '/l', logout_uri: '/o', logout_callback_uri: '/oc', logout_redirect_uri: '/or', sp_cert: CERT, sp_private_key: pem(STORED), secret: 'saml-s3cret-value' } } };

  it('saml-auth’s sp_private_key in View JSON: masked, and still masked once the other secrets are shown; Copy says so', async () => {
    renderWithProviders(<ViewJsonDialog open onClose={() => {}} title="saml" kind="routes" id="r2" value={SAML} />, { replies: pluginReplies() });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') })).toBeInTheDocument());
    expect(inPage(STORED)).toBe(false);
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(inPage('saml-s3cret-value')).toBe(true);
    expect(inPage(STORED)).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: t('json.copy') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('json.copiedNoKey')));
    expect(await navigator.clipboard.readText()).not.toContain(STORED);
  });

  it('what the lists and the palette search read (redactObject) holds none, revealed or not, the plugin list loaded or not', () => {
    for (const all of [pluginFixture().http, undefined]) {
      const hidden = redactObject(SAML, 'routes', all, 'r2');
      expect(JSON.stringify(hidden.value)).not.toContain(STORED);
      expect(JSON.stringify(hidden.revealed)).not.toContain(STORED);
    }
  });
});

/** Every string field of an analysis, with its path (`[]` for a list's items). */
function stringFields(node: Node, path: string[] = []): string[][] {
  switch (node.kind) {
    case 'string':
      return [path];
    case 'object': {
      const out: string[][] = [];
      const part = (p: { props: { key: string; node: Node }[]; conditionals: { then?: unknown; else?: unknown }[] }) => {
        for (const prop of p.props) out.push(...stringFields(prop.node, [...path, prop.key]));
        for (const c of p.conditionals) for (const b of [c.then, c.else]) if (b) part(b as typeof p);
      };
      part(node);
      return out;
    }
    case 'array-object':
    case 'array-scalar':
      return stringFields(node.item, [...path, '[]']);
    case 'variant':
      return node.options.flatMap((o) => stringFields(o.node, path));
    default:
      return [];
  }
}

/** A value with `leaf` at `path`, a list of one item at each `[]`. */
function valueAt(path: string[], leaf: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return leaf;
  return head === '[]' ? [valueAt(rest, leaf)] : { [head]: valueAt(rest, leaf) };
}

describe('the 3.20 plugin schemas, walked: every field where a PEM private key is stored', () => {
  const isKeyField = (path: string[]) => /(^|_)private_key$|^client_key$/.test(path.at(-1) ?? '');
  const fields = everySchema().flatMap(({ schema, label }) =>
    stringFields(analyze(schema))
      .filter(isKeyField)
      .map((path) => ({ schema, label, path })),
  );

  it('names them', () => {
    expect([...new Set(fields.map(({ label, path }) => `${label} ${path.join('.')}`))].sort()).toEqual([
      'http:google-cloud-logging:schema auth_config.private_key',
      'http:openid-connect:schema client_rsa_private_key',
      'http:openid-connect:schema dpop.private_key',
      'http:saml-auth:schema sp_private_key',
      'http:traffic-split:schema rules.[].weighted_upstreams.[].upstream.tls.client_key',
      'stream:traffic-split:schema rules.[].weighted_upstreams.[].upstream.tls.client_key',
    ]);
  });

  it('each holding one is never shown, locked or editing: "set, not shown", no Show', () => {
    for (const { schema, label, path } of fields) {
      for (const locked of [true, false]) {
        const where = `${label} ${path.join('.')} ${locked ? 'locked' : 'editing'}`;
        renderSchemaForm(schema, valueAt(path, pem(STORED)), { locked });
        expect(inPage(STORED), where).toBe(false);
        const words = [t('sf.secret.stored'), t('sf.secret.set'), t('sf.secret.entered')];
        expect(screen.queryAllByText((text) => words.includes(text)).length, where).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: t('sf.secret.show', { name: path.at(-1) ?? '' }) }), where).toBeNull();
        cleanup();
      }
    }
  });
});

describe('any other field holding a key (a plain text field, a list of tags, a map of text)', () => {
  it('is never shown either, locked or editing', () => {
    const schema: Obj = {
      type: 'object',
      properties: { note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, headers: { type: 'object', additionalProperties: { type: 'string' } } },
    };
    for (const locked of [true, false]) {
      renderSchemaForm(schema, { note: pem(STORED), tags: ['a', pem(STORED)], headers: { 'X-A': 'a', 'X-Key': pem(STORED) } }, { locked });
      expect(inPage(STORED), locked ? 'locked' : 'editing').toBe(false);
      cleanup();
    }
  });

  it('a key typed into a plain text field shows until the field is left', async () => {
    const form = renderSchemaForm({ type: 'object', properties: { note: { type: 'string' }, other: { type: 'string' } } }, {});
    const box = screen.getByRole('textbox', { name: /^note/ });
    await form.user.click(box);
    await form.user.paste(pem(NEW).replace(/\n/g, ' '));
    expect(inPage(NEW)).toBe(true);
    await form.user.click(screen.getByRole('textbox', { name: /^other/ }));
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    expect(screen.getByText(t('sf.secret.entered'))).toBeInTheDocument();
    expect((form.value() as Obj).note).toContain(NEW);
  });
});

// The conflict diff: a component test, beside ConflictDialog's own.
describe('the conflict diff', () => {
  it('masks a key in any field on both sides, Show secrets included', async () => {
    const { ConflictDialog } = await import('../editor/ConflictDialog');
    const loaded = { id: 'r1', desc: pem(STORED), plugins: { 'authz-keycloak': { client_id: 'c', client_secret: 'kc-s3cret' } } };
    const theirs = { ...loaded, desc: pem(NEW) };
    render(<ConflictDialog kind="Route" name="r" resource="routes" plugins={pluginFixture().http} loaded={loaded} theirs={theirs} onOverwrite={() => {}} onReload={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(inPage(STORED) || inPage(NEW)).toBe(false);
    expect(within(dialog).getByText(/\(changed\)/)).toBeInTheDocument();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(inPage(STORED) || inPage(NEW)).toBe(false);
  });
});

// Fix round 2, R1.2: outside an SSL's own slots a note resolves only at the path it was made for.
describe('a note moved to another field', () => {
  async function editJson() {
    const app = await open('#/routes/r1?tab=json');
    await app.user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const shown = JSON.parse(box.textContent ?? '{}') as Obj;
    const plugins = shown.plugins as Obj;
    const token = note.exec(JSON.stringify(shown))?.[0] ?? '';
    return { ...app, box, shown, plugins, token };
  }

  it('into a proxy-rewrite header (the stored key replaced by a new one where it was): refused, nothing sent, the key in no view', async () => {
    const { user, admin, box, shown, plugins, token } = await editJson();
    const moved = JSON.stringify({
      ...shown,
      plugins: { 'traffic-split': split(pem(NEW)), 'proxy-rewrite': { headers: { set: { 'X-K': token } } } },
    });
    expect(JSON.stringify(plugins)).toContain(token);
    await replaceText(user, box, moved);
    expect(await main().findByText(t('json.note.moved'))).toBeInTheDocument();
    await user.keyboard('{Control>}s{/Control}');
    expect(writesOf(admin)).toEqual([]);
    expect(inPage(STORED)).toBe(false);
  });

  it('into desc: refused, nothing sent, and the General tab never shows the key', async () => {
    const { user, admin, box, shown, token } = await editJson();
    await replaceText(user, box, JSON.stringify({ ...shown, plugins: { 'traffic-split': split(pem(NEW)) }, desc: token }));
    expect(await main().findByText(t('json.note.moved'))).toBeInTheDocument();
    await user.keyboard('{Control>}s{/Control}');
    expect(writesOf(admin)).toEqual([]);
    expect(inPage(STORED)).toBe(false);
  });

  it('left in place with another change: saved, the stored key sent', async () => {
    const { user, admin, box, shown, token } = await editJson();
    expect(token).not.toBe('');
    await replaceText(user, box, JSON.stringify({ ...shown, name: 'split2' }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'split2', plugins: { 'traffic-split': split(pem(STORED)) } });
  });

  it('replaced at its own path by a new key: the new key sent', async () => {
    const { user, admin, box, shown } = await editJson();
    await replaceText(user, box, JSON.stringify({ ...shown, plugins: { 'traffic-split': split(pem(NEW)) } }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ plugins: { 'traffic-split': split(pem(NEW)) } });
  });
});

// Fix round 2, R1.4: a raw PEM pasted into a JSON string (real newlines: the JSON does not parse, the
// text is held) is a note once the editor is left, in all three views; the text is then taken as usual.
describe('a raw key pasted into JSON text that does not parse', () => {
  const raw = (json: string) => json.replace('"§"', `"${pem(NEW)}"`);

  it('the JSON tab: a note once left, nothing of it in the page or the undo history; the text is then taken and Save sends the key pasted', async () => {
    const { user, admin } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const shown = JSON.parse(box.textContent ?? '{}') as Obj;
    await replaceText(user, box, raw(JSON.stringify({ ...shown, desc: '§' })));
    expect(await main().findByText(/^Not valid JSON/)).toBeInTheDocument();
    expect(inPage(NEW)).toBe(true);
    await user.click(main().getByRole('heading', { level: 1, name: 'split' }));
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    await user.click(box);
    // The text is now the JSON with a note in the key's place: valid, and taken.
    const veiled = box.textContent ?? '';
    expect(veiled).toMatch(note);
    expect(main().queryByText(/^Not valid JSON/)).not.toBeInTheDocument();
    // Undo never brings the key back.
    await user.keyboard('{Control>}z{/Control}');
    await user.keyboard('{Control>}z{/Control}');
    expect(inPage(NEW)).toBe(false);
    await replaceText(user, box, veiled);
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ desc: pem(NEW), plugins: { 'traffic-split': split(pem(STORED)) } });
  });

  it('a plugin card’s JSON view: a note once left; the text is then taken', async () => {
    const { renderPluginsTab } = await import('../test/plugins');
    const harness = renderPluginsTab({ scope: 'route', value: { 'proxy-rewrite': { uri: '/x' } }, validate: false });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    const card = screen.getByRole('group', { name: 'proxy-rewrite' });
    await harness.user.click(within(card).getByRole('button', { name: 'proxy-rewrite' }));
    await harness.user.click(within(card).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'proxy-rewrite' }) });
    await replaceText(harness.user, box, raw('{"uri": "/x", "headers": {"set": {"X-K": "§"}}}'));
    expect(inPage(NEW)).toBe(true);
    await harness.user.click(document.body);
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    expect(box.textContent).toMatch(note);
    expect(harness.held()).toEqual([]);
    expect(harness.value()).toEqual({ 'proxy-rewrite': { uri: '/x', headers: { set: { 'X-K': pem(NEW) } } } });
  });

  it('a schema-form JSON field: a note once left; the text is then taken', async () => {
    const form = renderSchemaForm({ type: 'object', properties: { body_schema: { type: 'object' } } }, {});
    const box = await screen.findByRole('textbox', { name: t('sf.json.label', { key: 'body_schema' }) });
    await replaceText(form.user, box, raw('{"k": "§"}'));
    expect(inPage(NEW)).toBe(true);
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(NEW)).toBe(false));
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ body_schema: { k: pem(NEW) } });
  });
});

// Fix round 2, R3.1: ordinary dots are ordinary text; only a note's own words or a whole mask run are a damaged note.
describe('ordinary text with dots', () => {
  it('"steps •• done" in a route’s JSON tab is taken and saved as typed; a whole mask run typed there is refused', async () => {
    const { user, admin } = await open('#/routes/r1?tab=json');
    await user.keyboard('e');
    const box = await jsonTab();
    await waitFor(() => expect(box.textContent).toMatch(note));
    const shown = JSON.parse(box.textContent ?? '{}') as Obj;
    await replaceText(user, box, JSON.stringify({ ...shown, desc: '•••••••• here' }));
    expect(await main().findByText(t('json.note.unknown'))).toBeInTheDocument();
    await replaceText(user, box, JSON.stringify({ ...shown, desc: 'steps •• done' }));
    await waitFor(() => expect(main().queryByText(t('json.note.unknown'))).not.toBeInTheDocument());
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ desc: 'steps •• done', plugins: { 'traffic-split': split(pem(STORED)) } });
  });
});
