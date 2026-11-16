// Final wave D1: a private key stored in a plugin's own upstream (traffic-split.rules[].weighted_upstreams[]
// .upstream.tls.client_key, which APISIX keeps as sent: only a route's or service's own upstream goes
// through upstream.encrypt_conf, apisix/upstream.lua 748–753) is never shown, as the upstream editor
// never shows its own: not in the plugin form, the card's JSON, View JSON, the conflict diff, Copy or
// the lists' search. The stored value is kept on save.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { ConflictDialog } from '../editor/ConflictDialog';
import { t } from '../i18n';
import { MASK } from '../schema/secrets';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { analyze, type Node } from '../schema-form/analyze';
import { everySchema, pluginFixture } from '../test/pluginFixture';
import { pluginReplies } from '../test/plugins';
import { getToasts } from '../ui/toast';
import { redactObject } from './secrets';

beforeAll(async () => {
  await import('../resources/routes/bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

// Long enough for APISIX's schema (private_key_schema and certificate_scheme: minLength 128, schema_def.lua).
const KEY_BODY = `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7neverShown${'A'.repeat(100)}`;
const KEY = `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----\nMIIBclientcert${'B'.repeat(120)}\n-----END CERTIFICATE-----`;
const split = (key: string): Obj => ({
  rules: [
    {
      weighted_upstreams: [
        { upstream: { type: 'roundrobin', scheme: 'https', nodes: { '10.0.0.9:443': 1 }, tls: { client_cert: CERT, client_key: key } }, weight: 1 },
        { weight: 1 },
      ],
    },
  ],
});
const ROUTE: Obj = { id: 'r1', name: 'split', uri: '/s', plugins: { 'traffic-split': split(KEY) }, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };

const page = () => document.body.innerHTML;

async function openCard() {
  const app = await openEditor('#/routes/r1?tab=plugins', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: 'split' });
  const card = await main().findByRole('group', { name: 'traffic-split' });
  await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
  await app.user.click(within(card).getByRole('button', { name: 'traffic-split' }));
  await within(card).findByRole('button', { name: t('pl.card.json') });
  return { ...app, card };
}

describe('traffic-split’s upstream tls.client_key is never shown', () => {
  it('the locked form says it is set; the card’s JSON masks it, Show secrets included', async () => {
    const { user, card } = await openCard();
    await waitFor(() => expect(within(card).getByText(t('sf.secret.stored'))).toBeInTheDocument());
    expect(page()).toContain('MIIBclientcert');
    expect(page()).not.toContain(KEY_BODY);

    await user.click(within(card).getByRole('button', { name: t('pl.card.json') }));
    const json = await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'traffic-split' }) });
    expect(json.textContent).toContain(`"client_key": "${MASK}"`);
    expect(page()).not.toContain(KEY_BODY);
    // Nothing else in it is secret: no Show secrets to offer.
    expect(within(card).queryByRole('button', { name: t('pl.card.secrets.show') })).toBeNull();
  });

  it('editing, the form shows no Show for it; the stored key is what a save of another change sends', async () => {
    const { user, card, admin } = await openCard();
    await user.keyboard('e');
    await waitFor(() => expect(within(card).getByText(t('sf.secret.set'))).toBeInTheDocument());
    expect(page()).not.toContain(KEY_BODY);
    expect(within(card).queryByRole('button', { name: t('sf.secret.show', { name: 'client_key' }) })).toBeNull();
    // Replace opens an empty box, never the key.
    expect(within(card).getByRole('button', { name: t('sf.secret.replace', { name: 'client_key' }) })).toBeInTheDocument();

    await user.click(main().getByRole('tab', { name: /^General/ }));
    await user.type(await main().findByRole('textbox', { name: t('rt.general.name') }), '2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ name: 'split2', plugins: { 'traffic-split': split(KEY) } });
  });

  it('View JSON masks it, Show secrets included, and Copy says the private key is left out', async () => {
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'split' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const dialog = await screen.findByRole('dialog');
    expect(page()).not.toContain(KEY_BODY);
    const show = within(dialog).queryByRole('button', { name: t('pl.card.secrets.show') });
    if (show) await user.click(show);
    expect(page()).not.toContain(KEY_BODY);
    await user.click(within(dialog).getByRole('button', { name: t('json.copy') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('json.copiedNoKey')));
    expect(await navigator.clipboard.readText()).not.toContain(KEY_BODY);
  });

  it('the conflict diff masks both sides, Show secrets included; a changed key still reads as changed', async () => {
    // Another secret (a revealable one) beside it, so the diff offers Show secrets.
    const loaded = { ...ROUTE, plugins: { ...(ROUTE.plugins as Obj), 'authz-keycloak': { client_id: 'c', client_secret: 'kc-s3cret' } } };
    const theirs = { ...loaded, plugins: { ...(loaded.plugins as Obj), 'traffic-split': split(KEY.replace('neverShown', 'theirsKey')) } };
    render(<ConflictDialog kind="Route" name="split" resource="routes" plugins={pluginFixture().http} loaded={loaded} theirs={theirs} onOverwrite={() => {}} onReload={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(page()).not.toContain(KEY_BODY);
    expect(page()).not.toContain('theirsKey');
    expect(within(dialog).getByText(/"client_key": "•+ \(changed\)"/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(within(dialog).getByRole('button', { name: t('pl.card.secrets.hide') })).toHaveAttribute('aria-pressed', 'true');
    expect(page()).not.toContain(KEY_BODY);
    expect(page()).not.toContain('theirsKey');
  });

  it('the lists’ search reads the object as redactObject masks it, revealed or not', () => {
    const hidden = redactObject(ROUTE, 'routes', pluginFixture().http, 'r1');
    expect(JSON.stringify(hidden.value)).not.toContain(KEY_BODY);
    expect(JSON.stringify(hidden.revealed)).not.toContain(KEY_BODY);
    // While the plugin list loads too.
    expect(JSON.stringify(redactObject(ROUTE, 'routes', undefined, 'r1').revealed)).not.toContain(KEY_BODY);
  });
});

/** Every string node of a schema's analysis with the property key it is for, through objects (and their branches), lists, maps and variants. */
function stringNodes(node: Node, key = ''): { key: string; node: Extract<Node, { kind: 'string' }> }[] {
  switch (node.kind) {
    case 'string':
      return [{ key, node }];
    case 'object': {
      const out: ReturnType<typeof stringNodes> = [];
      const part = (p: { props: { key: string; node: Node }[]; conditionals: { then?: unknown; else?: unknown }[] }) => {
        for (const prop of p.props) out.push(...stringNodes(prop.node, prop.key));
        for (const c of p.conditionals) for (const b of [c.then, c.else]) if (b) part(b as typeof p);
      };
      part(node);
      return out;
    }
    case 'array-scalar':
    case 'array-object':
      return stringNodes(node.item, key);
    case 'map':
      return stringNodes(node.value, key);
    case 'variant':
      return node.options.flatMap((o) => stringNodes(o.node, key));
    default:
      return [];
  }
}

describe('the 3.20 schemas, walked: every client_key a plugin form can show', () => {
  it('is in traffic-split’s upstream (http and stream) only, and the form never shows it', () => {
    const found: string[] = [];
    for (const { schema, label } of everySchema()) {
      for (const { key, node } of stringNodes(analyze(schema))) {
        if (key !== 'client_key') continue;
        found.push(label);
        expect(node, label).toMatchObject({ secret: true, multiline: true, neverShown: true });
      }
    }
    expect([...new Set(found)].sort()).toEqual(['http:traffic-split:schema', 'stream:traffic-split:schema']);
  });
});
