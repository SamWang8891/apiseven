// The SSL editor as the registry wires it, on a fake Admin API that keeps a private key the way APISIX
// does (stored encrypted, never returned by a GET): its tabs, the locked view, and what each save
// sends. The key is checked to be nowhere on the page after every step that could leave it there.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { EC_IPV6, RSA_LEAF } from '../../test/certs';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { editableControls } from '../../test/schemaForm';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { getToasts } from '../../ui/toast';
import { fingerprintOf } from './fingerprint';

beforeAll(async () => {
  await import('./bodies');
  // The fingerprints the tests show, computed once: no late update after a test.
  await Promise.all([fingerprintOf(SEED_CERT), fingerprintOf(RSA_LEAF), fingerprintOf(EC_IPV6)]);
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

/** A line of the seed key's base64: present in the page only if the key is. */
const SEED_KEY_TEXT = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg59GD85BzOUzXl7Hu';
/** A new key for Replace: PEM-labelled (the fake doesn't parse it; APISIX would). */
const NEW_KEY_TEXT = 'NEWKEYMATERIALnewkeymaterialNEWKEYMATERIALnewkeymaterialNEWKEY0';
const NEW_KEY = `-----BEGIN PRIVATE KEY-----\n${NEW_KEY_TEXT}\n-----END PRIVATE KEY-----\n`;

const STORED: Obj = {
  id: 'apiseven-test',
  type: 'server',
  snis: ['apiseven.test', '*.apiseven.test'],
  cert: SEED_CERT,
  key: SEED_KEY,
  labels: { env: 'dev' },
  // A key no tab models (APISIX 3.20's schema has none to add; a newer one might): every save of a
  // stored SSL is a PATCH, which leaves it alone; a copy takes it.
  x_future: { kept: true },
  create_time: 1700000000,
  update_time: 1700000100,
};
const CLIENT: Obj = { id: 'to-backend', type: 'client', cert: SEED_CERT, key: SEED_KEY, status: 0 };

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('ssl.tab.certificate'), t('ssl.tab.snis'), t('ssl.tab.client'), t('ssl.tab.general'), t('editor.json.tab')];
const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));
const keyLine = () => main().getByRole('definition', { name: t('ssl.key.label') });

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
  return panel;
}

async function openSsl(hash = '#/ssls/apiseven-test', objects: Obj[] = [STORED], replies?: FakeAdminOptions['replies']) {
  const app = await openEditor(hash, { objects: { ssls: objects, routes: [], services: [] }, replies });
  await main().findByRole('heading', { level: 1 });
  await settled();
  return app;
}

/** Replace certificate → the dialog → paste a pair → Apply. */
async function replaceWith(user: UserEvent, cert: string, key: string) {
  await user.click(main().getByRole('button', { name: t('ssl.replace') }));
  const dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
  await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
  await user.paste(cert);
  await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
  await user.paste(key);
  await user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('the SSL editor', () => {
  it('has Certificate, SNIs, Client mTLS, General and JSON, and opens on Certificate, named by its first SNI', async () => {
    await openSsl();
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('ssl.tab.certificate'))).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('heading', { level: 1 })).toHaveTextContent('apiseven.test');
  });

  it('opened locked: the certificate reads as its details, every tab has no form controls, and the key is nowhere', async () => {
    const { user } = await openSsl();
    const details = main().getByRole('region', { name: t('ssl.cert.region') });
    expect(within(details).getByRole('definition', { name: t('ssl.cert.subject') })).toHaveTextContent('CN=apiseven.test');
    expect(within(details).getByRole('definition', { name: t('ssl.cert.sans') })).toHaveTextContent('apiseven.test*.apiseven.test');
    expect(within(details).getByRole('definition', { name: t('ssl.cert.notAfter') })).toHaveTextContent('2036-11-11');
    expect(keyLine()).toHaveTextContent(t('ssl.key.stored'));
    for (const label of TAB_LABELS().slice(0, 4)) {
      await user.click(tab(label));
      const panel = await settled();
      expect(editableControls(panel), label).toEqual([]);
    }
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });

  it("a client certificate's status does nothing: the header says so and offers no switch, locked or editing", async () => {
    const { user } = await openSsl('#/ssls/to-backend', [CLIENT]);
    expect(main().getByText(t('table.status.ignored'))).toHaveAttribute('title', t('ssl.status.ignored'));
    expect(main().queryByRole('switch')).toBeNull();
    await user.keyboard('e');
    expect(main().queryByRole('switch', { name: t('table.status.toggle', { name: 'to-backend' }) })).toBeNull();
  });
});

describe('what each save sends: a PATCH of what changed, unless a new key is in the draft', () => {
  it('SNIs only: PATCH {snis}, no cert, no key', async () => {
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=snis');
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'www.apiseven.test{Enter}');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { snis: ['apiseven.test', '*.apiseven.test', 'www.apiseven.test'] } });
  });

  it('General and Client mTLS send only their change; switching mTLS off removes client', async () => {
    const withMtls = { ...STORED, client: { ca: SEED_CERT, depth: 1 } };
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=general', [withMtls]);
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('ssl.general.desc') }), 'Dev');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ desc: 'Dev' });

    await main().findByRole('button', { name: t('editor.edit') });
    await user.click(tab(t('ssl.tab.client')));
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: t('ssl.client.enable') }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { client: null } });
  });

  it('Replace: PATCH {cert, key} (APISIX encrypts the key and merges); the key is never on the page', async () => {
    const { user, admin } = await openSsl();
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    expect(keyLine()).toHaveTextContent(t('ssl.key.replaced'));
    expect(main().getByRole('region', { name: t('ssl.cert.region') })).toHaveTextContent('CN=example.org');
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { cert: RSA_LEAF, key: NEW_KEY } });
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
  });

  it('Replace on an SSL with an extra pair: PATCH {cert, key}; the extra pair keeps its stored key, nothing to re-enter', async () => {
    const withPair = { ...STORED, certs: [RSA_LEAF] };
    const { user, admin } = await openSsl('#/ssls/apiseven-test', [{ ...withPair, keys: [SEED_KEY] }]);
    await user.keyboard('e');
    await replaceWith(user, EC_IPV6, NEW_KEY);
    expect(main().getByRole('listitem', { name: t('ssl.extra.row', { n: 1 }) })).toHaveTextContent(t('ssl.extra.stored'));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { cert: EC_IPV6, key: NEW_KEY } });
    // The stored extra key is still there (the fake keeps it encrypted, as APISIX does).
    expect(admin.stored('ssls')[0]).toMatchObject({ certs: [RSA_LEAF], keys: [expect.stringMatching(/^AES:/)] });
  });

  it('Replace, Save, Edit: the key reads "stored" again and the next save is a PATCH without it', async () => {
    const { user, admin } = await openSsl();
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    await save(user);
    await main().findByRole('button', { name: t('editor.edit') });
    expect(keyLine()).toHaveTextContent(t('ssl.key.stored'));
    await user.keyboard('e');
    expect(keyLine()).toHaveTextContent(t('ssl.key.stored'));
    await user.click(tab(t('ssl.tab.general')));
    await settled();
    await user.type(main().getByRole('textbox', { name: t('ssl.general.desc') }), 'x');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { desc: 'x' } });
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
  });

  it('Replace, then Cancel: nothing reaches the draft, and reopening the dialog starts empty', async () => {
    const { user, admin } = await openSsl();
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('ssl.replace') }));
    let dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(NEW_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
    await user.click(main().getByRole('button', { name: t('ssl.replace') }));
    dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
    expect(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') })).toHaveValue('');
    await user.keyboard('{Escape}');
    await save(user);
    expect(getToasts().at(-1)?.message).toBe(t('editor.nothingToSave'));
    expect(writesOf(admin)).toEqual([]);
  });

  it('a refused save keeps the replacement: still editing, and the next Save sends the key again', async () => {
    let refuse = true;
    const { user, admin } = await openSsl('#/ssls/apiseven-test', [STORED], {
      'ssls/apiseven-test': (req) => (req.method === 'PATCH' && refuse ? ((refuse = false), json(400, { error_msg: 'failed to parse key: PEM_read_bio_PrivateKey() failed' })) : undefined),
    });
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    await save(user);
    await waitFor(() => expect(main().getByRole('alert')).toHaveTextContent('failed to parse key'));
    expect(keyLine()).toHaveTextContent(t('ssl.key.replaced'));
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { key: NEW_KEY, cert: RSA_LEAF } });
  });

  it('the JSON tab shows a note for the new key, never the key; an edit there keeps it, removing the note drops it', async () => {
    const { user, admin } = await openSsl();
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    await user.click(tab(t('editor.json.tab')));
    const box = await jsonEditor(t('kind.ssls.singular'));
    await waitFor(() => expect(box.textContent).toContain(t('json.keyHidden')));
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);

    await user.click(main().getByRole('button', { name: t('json.copy') }));
    expect(await navigator.clipboard.readText()).not.toContain(NEW_KEY_TEXT);
    expect(getToasts().at(-1)?.message).toBe(t('json.copiedNoKey'));

    const shown = JSON.parse(box.textContent ?? '{}') as Obj;
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...shown, desc: 'from json' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { cert: RSA_LEAF, key: NEW_KEY, desc: 'from json' } });

    await main().findByRole('button', { name: t('editor.edit') });
    await user.click(tab(t('ssl.tab.certificate')));
    await settled();
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    await user.click(tab(t('editor.json.tab')));
    const again = await jsonEditor(t('kind.ssls.singular'));
    const withNote = JSON.parse(again.textContent ?? '{}') as Obj;
    delete withNote.key;
    await user.click(again);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...withNote, desc: 'kept key' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { desc: 'kept key' } });
  });

  it('a conflict after Replace shows no key; Overwrite sends a PATCH of mine against theirs, with the key', async () => {
    const { user, admin } = await openSsl();
    await user.keyboard('e');
    await replaceWith(user, RSA_LEAF, NEW_KEY);
    admin.touch('ssls', 'apiseven-test', { snis: ['apiseven.test'] });
    await save(user);
    const dialog = await screen.findByRole('dialog', { name: t('editor.conflict.title', { kind: t('kind.ssls.singular'), name: 'apiseven.test' }) });
    expect(dialog).toHaveTextContent('apiseven.test');
    expect(document.body.innerHTML).not.toContain(NEW_KEY_TEXT);
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
    await user.click(within(dialog).getByRole('button', { name: t('editor.conflict.overwrite') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { key: NEW_KEY, cert: RSA_LEAF, snis: STORED.snis } });
  });
});

describe('creating an SSL', () => {
  it('Create is refused until both certificate and key are there (an issue on Certificate), then POSTs them', async () => {
    const { user, admin } = await openEditor('#/ssls/new?tab=snis', { objects: { ssls: [], routes: [], services: [] } });
    await settled();
    await user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'tls.apiseven.test{Enter}');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await waitFor(() => expect(tab(t('ssl.tab.certificate'))).toHaveAccessibleName(`${t('ssl.tab.certificate')} ${t('ui.tabs.errors', { count: 2 })}`));

    await settled();
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await waitFor(() => expect(tab(t('ssl.tab.certificate'))).toHaveAccessibleName(`${t('ssl.tab.certificate')} ${t('ui.tabs.errors', { count: 1 })}`));

    await user.click(main().getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.tab();
    // Once entered and left, the key is no longer shown: one line says so.
    expect(main().queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(main().getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'POST', path: 'ssls', body: { status: 1, sni: 'tls.apiseven.test', cert: SEED_CERT, key: SEED_KEY } });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/ssls\/0+\d+$/));
    expect(await screen.findByRole('heading', { level: 1, name: 'tls.apiseven.test' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });

  it('a typed ID that is taken is refused without a write (create never overwrites)', async () => {
    const { user, admin } = await openEditor('#/ssls/new', { objects: { ssls: [STORED], routes: [], services: [] } });
    await settled();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'apiseven-test');
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(tab(t('ssl.tab.snis')));
    await settled();
    await user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'x.apiseven.test{Enter}');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.taken.message', { kind: t('kind.ssls.singular'), id: 'apiseven-test' })));
    expect(writesOf(admin)).toEqual([]);
  });

  it('Duplicate: the copy has everything but the key (APISIX never returns it); Create waits for one', async () => {
    const { user, admin } = await openEditor('#/ssls/new?from=apiseven-test', { objects: { ssls: [STORED], routes: [], services: [] } });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    expect(main().getByRole('note')).toHaveTextContent(t('ssl.key.copyNote'));
    expect(main().getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(SEED_CERT);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'POST', path: 'ssls', body: { type: 'server', snis: STORED.snis, cert: SEED_CERT, key: SEED_KEY, labels: { env: 'dev' }, x_future: { kept: true } } });
  });
});

describe('what the Client mTLS tab shows is what gets saved', () => {
  const saveKeys = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

  it('CA text that is not PEM blocks Save and Cmd/Ctrl-S, naming the field; a CA that is saves exactly that', async () => {
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=client');
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: t('ssl.client.enable') }));
    const ca = main().getByRole('textbox', { name: t('ssl.client.ca') });
    await user.type(ca, 'not a certificate');
    saveKeys();
    const held = t('ui.pending.problem', { field: t('ssl.client.ca'), problem: t('ssl.pem.noCertLabel') });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixMany', { count: 2 }), message: held })));
    await save(user);
    expect(writesOf(admin)).toEqual([]);
    expect(ca).toHaveAttribute('aria-invalid', 'true');

    await user.click(tab(t('ssl.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(dialog).toHaveTextContent(held);
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));

    await user.clear(ca);
    await user.click(ca);
    await user.paste(SEED_CERT);
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { client: { ca: SEED_CERT } } });
  });
});

describe('the SSL list', () => {
  it('bulk Disable writes the server certificates only: a client certificate has no status to switch', async () => {
    const { user, admin } = await openEditor('#/ssls', { objects: { ssls: [STORED, CLIENT], routes: [], services: [], upstreams: [] } });
    await main().findByRole('link', { name: 'apiseven.test' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 2 }) }));
    await user.click(main().getByRole('button', { name: t('action.disable') }));
    expect(await screen.findByText(t('bulk.done', { action: t('action.disable'), done: 1 }))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([{ method: 'PATCH', path: 'ssls/apiseven-test', body: { status: 0 } }]);
  });

  it("search never finds a key (no listed SSL has one); a client certificate's status reads as not used, with no switch", async () => {
    const { user } = await openEditor('#/ssls', { objects: { ssls: [STORED, CLIENT], routes: [], services: [], upstreams: [] } });
    const row = (await main().findByRole('link', { name: 'apiseven.test' })).closest('tr') as HTMLElement;
    expect(within(row).getByRole('switch')).toBeChecked();
    const client = main().getByRole('link', { name: 'to-backend' }).closest('tr') as HTMLElement;
    expect(within(client).queryByRole('switch')).toBeNull();
    expect(within(client).getByText(t('table.status.ignored'))).toBeInTheDocument();
    await user.type(main().getByRole('searchbox'), SEED_KEY_TEXT.slice(0, 20));
    await waitFor(() => expect(main().queryByRole('link', { name: 'apiseven.test' })).toBeNull());
    expect(main().queryByRole('link', { name: 'to-backend' })).toBeNull();
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });
});
