// The rule for a secret field in a form, through the real editor (Task 15, fix round 3): "the stored
// value" comes from the object as the editor last loaded it, never from what a field saw when it
// mounted; what a field shows survives a tab switch, a late refused save and a refresh while locked.
// The re-reviewer's probes: Replace → type → JSON tab → back (G2); a new object's typed key after a tab
// switch (G3); another writer's key while the page is locked (B1 a); a multi-line secret a refresh
// adds on a locked page (B1 b); an SSL's CA pasted over a stored one holding a key, then a late
// refused save (A1).
import { act, screen, waitFor, within } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { EditorPage } from '../pages/EditorPage';
import { fingerprintOf } from '../resources/ssls/fingerprint';
import { resetApp } from '../test/app';
import { RSA_LEAF } from '../test/certs';
import { main, openEditor, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import { renderWithProviders } from '../test/providers';
import { SEED_CERT, SEED_KEY } from '../test/sslSeed';

beforeAll(async () => {
  await import('../resources/secrets/bodies');
  await import('../resources/global_rules/bodies');
  await import('../resources/ssls/bodies');
  await import('../plugins/PluginsTab');
  await import('../schema-form/SchemaForm');
  await Promise.all([SEED_CERT, RSA_LEAF].map(fingerprintOf));
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
  focusManager.setFocused(undefined);
});

const KEY = '-----BEGIN PRIVATE KEY-----\nGCPSTOREDKEYTEXT\n-----END PRIVATE KEY-----\n';
const GCP: Obj = { id: 'gcp/g1', auth_config: { client_email: 'svc@p.iam', private_key: KEY, project_id: 'p1' } };
const later = (body: () => Response) => new Promise<Response>((resolve) => setTimeout(() => resolve(body()), 60));
const keyBox = () => main().getByRole('textbox', { name: 'private_key (required)' });
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: /^(Save|Create)/ }));

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
}

async function refocus() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

describe('G2 / G3: what the field shows and what Keep means survive a remount', () => {
  it('Replace → type → JSON tab → back: "a new value was entered"; Keep the stored value then Save sends the stored key', async () => {
    const { user, admin } = await openEditor('#/secrets/gcp%2Fg1', { objects: { secrets: [GCP] } });
    await main().findByRole('heading', { level: 1, name: 'gcp/g1' });
    await settled();
    await main().findByText('svc@p.iam');
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('sf.secret.replace', { name: 'private_key' }) }));
    await user.type(keyBox(), 'NEW');
    await user.click(main().getByRole('tab', { name: /^JSON/ }));
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('sc.tab.config')}`) }));
    await settled();
    expect(await main().findByText(t('sf.secret.entered'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('GCPSTOREDKEYTEXT');
    await user.click(main().getByRole('button', { name: t('sf.secret.keep') }));
    expect(main().getByText(t('sf.secret.stored'))).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'project_id (required)' }), '2');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(((writesOf(admin)[0]?.body as Obj).auth_config as Obj).private_key).toBe(KEY);
  });

  it('… and Replace there opens an empty box that keeps the stored key while empty: Save sends the stored key', async () => {
    const { user, admin } = await openEditor('#/secrets/gcp%2Fg1', { objects: { secrets: [GCP] } });
    await main().findByRole('heading', { level: 1, name: 'gcp/g1' });
    await settled();
    await main().findByText('svc@p.iam');
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('sf.secret.replace', { name: 'private_key' }) }));
    await user.type(keyBox(), 'NEW');
    await user.click(main().getByRole('tab', { name: /^JSON/ }));
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('sc.tab.config')}`) }));
    await settled();
    await user.click(await main().findByRole('button', { name: t('sf.secret.replace', { name: 'private_key' }) }));
    expect(keyBox()).toHaveValue('');
    expect(main().getByText(t('sf.secret.emptyStored'))).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'project_id (required)' }), '2');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(((writesOf(admin)[0]?.body as Obj).auth_config as Obj).private_key).toBe(KEY);
  });

  it('a new object: a typed key after a tab switch reads "a new value was entered", with no Keep (nothing is stored)', async () => {
    const { user } = await openEditor('#/secrets/~new', { objects: { secrets: [] } });
    await user.click(main().getByRole('combobox', { name: /^Secret manager/ }));
    await user.click(await screen.findByRole('option', { name: new RegExp(`^${t('sc.manager.gcp')}`) }));
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'g9');
    await settled();
    await main().findByRole('textbox', { name: 'auth_file' });
    if (!main().queryByRole('textbox', { name: /^client_email/ })) await user.click(main().getByRole('button', { name: /^auth_config/ }));
    await user.type(await main().findByRole('textbox', { name: /^private_key/ }), 'TYPEDKEY');
    expect(main().getByText(t('sf.secret.emptyNone'))).toBeInTheDocument();
    await user.click(main().getByRole('tab', { name: /^JSON/ }));
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('sc.tab.config')}`) }));
    await settled();
    if (!main().queryByText(t('sf.secret.entered'))) await user.click(main().getByRole('button', { name: /^auth_config/ }));
    expect(await main().findByText(t('sf.secret.entered'))).toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('sf.secret.keep') })).not.toBeInTheDocument();
  });
});

describe('B1: a refresh while the page is locked', () => {
  it('(a) another writer changes the key: Edit → Replace → type → Keep → Save sends their key, not the one first loaded', async () => {
    const user = userEvent.setup();
    const { admin } = renderWithProviders(<EditorPage kind="secrets" id="gcp/g1" />, { path: '/secrets/gcp%2Fg1', counts: {}, objects: { secrets: [GCP] } });
    await screen.findByRole('heading', { level: 1, name: 'gcp/g1' });
    await screen.findByText('svc@p.iam');
    const THEIRS = '-----BEGIN PRIVATE KEY-----\nTHEIRKEYTEXT\n-----END PRIVATE KEY-----\n';
    admin.touch('secrets', 'gcp/g1', { auth_config: { ...(GCP.auth_config as Obj), private_key: THEIRS } });
    await refocus();
    expect(document.body.innerHTML).not.toContain('THEIRKEYTEXT');
    await user.keyboard('e');
    await user.click(await screen.findByRole('button', { name: t('sf.secret.replace', { name: 'private_key' }) }));
    await user.type(screen.getByRole('textbox', { name: 'private_key (required)' }), 'MINE');
    await user.click(screen.getByRole('button', { name: t('sf.secret.keep') }));
    await user.type(screen.getByRole('textbox', { name: 'project_id (required)' }), '2');
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(((writesOf(admin)[0]?.body as Obj).auth_config as Obj).private_key).toBe(THEIRS);
  });

  it('(b) another writer adds a multi-line secret to a plugin, its card open: the locked page shows no secret text', async () => {
    const user = userEvent.setup();
    const RULE: Obj = { id: 'oidc', plugins: { 'openid-connect': { client_id: 'c', discovery: 'https://idp.test/.well-known/openid-configuration', client_secret: 's' } } };
    const { admin } = renderWithProviders(<EditorPage kind="global_rules" id="oidc" />, { path: '/global_rules/oidc', counts: {}, objects: { global_rules: [RULE] }, replies: pluginReplies() });
    await screen.findByRole('heading', { level: 1, name: 'oidc' });
    const card = await screen.findByRole('group', { name: 'openid-connect' });
    await user.click(within(card).getByRole('button', { name: 'openid-connect' }));
    await within(card).findByText('client_rsa_private_key');
    const plugins = RULE.plugins as Obj;
    admin.touch('global_rules', 'oidc', { plugins: { 'openid-connect': { ...(plugins['openid-connect'] as Obj), client_rsa_private_key: 'THEIR-RSA-KEY' } } });
    await refocus();
    await waitFor(() => expect(admin.requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/global_rules/oidc')).length).toBeGreaterThan(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('THEIR-RSA-KEY');
  });
});

describe('A1: an SSL CA taken over a stored one that holds a key, then a save APISIX refuses late', () => {
  it('the box shows the CA that was taken (what Save sends), with its details', async () => {
    const STORED: Obj = { id: 's1', type: 'server', snis: ['apiseven.test'], cert: SEED_CERT, client: { ca: SEED_CERT + SEED_KEY, depth: 1 } };
    const { user, admin } = await openEditor('#/ssls/s1?tab=client', {
      objects: { ssls: [STORED], routes: [], services: [] },
      replies: { 'ssls/s1': (req) => (req.method === 'PATCH' ? later(() => json(400, { error_msg: 'failed to validate client_cert: refused' })) : undefined) },
    });
    await main().findByRole('heading', { level: 1 });
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('ssl.client.replaceCa') }));
    await user.click(main().getByRole('textbox', { name: t('ssl.client.ca') }));
    await user.paste(RSA_LEAF);
    await save(user);
    expect((await main().findAllByText('failed to validate client_cert: refused')).length).toBeGreaterThan(0);
    expect(writesOf(admin)[0]?.body).toEqual({ client: { ca: RSA_LEAF } });
    // The page says what the draft holds: the CA taken, in its box.
    expect(main().getByRole('textbox', { name: t('ssl.client.ca') })).toHaveValue(RSA_LEAF);
    expect(document.body.innerHTML).not.toContain(SEED_KEY.split('\n')[1] as string);
  });
});
