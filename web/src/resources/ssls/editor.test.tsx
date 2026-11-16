// The SSL editor as the registry wires it, on a fake Admin API that keeps a private key the way APISIX
// does (stored encrypted, never returned by a GET): its tabs, the locked view, and what each save
// sends. The key is checked to be nowhere on the page after every step that could leave it there.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { EC_IPV6, RSA_LEAF } from '../../test/certs';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { deferredFile } from '../../test/deferredFile';
import { EC_PAIR } from '../../test/pairs';
import { editableControls } from '../../test/schemaForm';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { getToasts } from '../../ui/toast';
import { fingerprintOf } from './fingerprint';
import { newPathFor } from '../../router/paths';

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
    await waitFor(() => expect(box.textContent).toContain('private key'));
    expect(box.textContent).toContain('••••••••');
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

  describe('two consecutive edits in the JSON tab after the extra pairs moved (F1)', () => {
    const KA = `-----BEGIN PRIVATE KEY-----\n${'KEYALPHA'.repeat(9)}\n-----END PRIVATE KEY-----\n`;
    const KB = `-----BEGIN PRIVATE KEY-----\n${'KEYBRAVO'.repeat(9)}\n-----END PRIVATE KEY-----\n`;

    /** Pairs entered in the JSON tab, then the tab left and opened again: the keys show as notes. */
    async function withNotes(user: UserEvent) {
      await user.keyboard('e');
      await user.click(tab(t('editor.json.tab')));
      let box = await jsonEditor(t('kind.ssls.singular'));
      const shown = JSON.parse(box.textContent ?? '{}') as Obj;
      await user.click(box);
      await user.keyboard('{Control>}a{/Control}');
      await user.paste(JSON.stringify({ ...shown, certs: [RSA_LEAF, EC_IPV6], keys: [KA, KB] }));
      await user.click(tab(t('ssl.tab.general')));
      await settled();
      await user.click(tab(t('editor.json.tab')));
      box = await jsonEditor(t('kind.ssls.singular'));
      await waitFor(() => expect(box.textContent).not.toContain('KEYALPHA'));
      expect(box.textContent).not.toContain('KEYBRAVO');
      return box;
    }

    async function edit(user: UserEvent, box: HTMLElement, change: (o: Obj) => Obj) {
      const now = JSON.parse(box.textContent ?? '{}') as Obj;
      await user.click(box);
      await user.keyboard('{Control>}a{/Control}');
      await user.paste(JSON.stringify(change(now)));
    }

    it('after a swap and another edit, each certificate is sent with its own key', async () => {
      const { user, admin } = await openSsl();
      const box = await withNotes(user);
      await edit(user, box, (o) => ({ ...o, certs: [...(o.certs as string[])].reverse(), keys: [...(o.keys as string[])].reverse() }));
      await edit(user, box, (o) => ({ ...o, desc: 'after the swap' }));
      await save(user);
      await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
      expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { certs: [EC_IPV6, RSA_LEAF], keys: [KB, KA], desc: 'after the swap' } });
    });

    it('after a removal and another edit, the remaining key is its own, never the note', async () => {
      const { user, admin } = await openSsl();
      const box = await withNotes(user);
      await edit(user, box, (o) => ({ ...o, certs: [(o.certs as string[])[1]], keys: [(o.keys as string[])[1]] }));
      await edit(user, box, (o) => ({ ...o, desc: 'after the removal' }));
      await save(user);
      await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
      expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { certs: [EC_IPV6], keys: [KB], desc: 'after the removal' } });
    });
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
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}?tab=snis`, { objects: { ssls: [], routes: [], services: [] } });
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
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [STORED], routes: [], services: [] } });
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

  it('Duplicate: a notice above the tabs (on any tab) names the keys left out and the SNIs still shared; Create waits for a key', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}?from=apiseven-test&tab=snis`, { objects: { ssls: [STORED], routes: [], services: [] } });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    const notice = main().getByRole('note', { name: t('editor.copyNotice.title') });
    expect(notice).toHaveTextContent(t('editor.copyNotice.sslKey'));
    expect(notice).toHaveTextContent(t('editor.copyNotice.sslSnis', { list: 'apiseven.test, *.apiseven.test' }));
    await user.click(tab(t('ssl.tab.certificate')));
    await settled();
    expect(main().getByText(t('ssl.key.needed'))).toBeInTheDocument();
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

const saveKeys = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });
const heldToast = (field: string, problem: string, count = 1) =>
  t('editor.fixHeld', { fix: count === 1 ? t('editor.fixOne') : t('editor.fixMany', { count }), message: t('ui.pending.problem', { field, problem }) });

/** A new SSL with the seed pair entered and an SNI, back on the Certificate tab: nothing but the box under test can refuse Create. */
async function newSsl(user: UserEvent) {
  await settled();
  await user.click(main().getByRole('textbox', { name: t('ssl.pem.cert') }));
  await user.paste(SEED_CERT);
  await user.click(main().getByRole('textbox', { name: t('ssl.pem.key') }));
  await user.paste(SEED_KEY);
  await user.click(tab(t('ssl.tab.snis')));
  await settled();
  await user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'tls.apiseven.test{Enter}');
  await user.click(tab(t('ssl.tab.certificate')));
  await settled();
}

describe('N1: text a box did not take is held through Save, never swapped for the old value', () => {
  const COMBINED = RSA_LEAF + SEED_KEY;

  it('a combined text pasted over a new SSL certificate, then Create: refused, no request, the toast names the field', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    const box = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(COMBINED);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.cert'), t('ssl.split.held'))));
    expect(writesOf(admin)).toEqual([]);
    // Left by the click: the key block is a marker now, and the text is still held.
    expect(box).toHaveValue(RSA_LEAF + `${t('ssl.pem.marker')}\n`);
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });

  it('a combined text pasted over a stored CA, then Ctrl-S: refused, no request, the toast names the field', async () => {
    const withCa = { ...STORED, client: { ca: SEED_CERT, depth: 1 } };
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=client', [withCa]);
    await user.keyboard('e');
    const depth = main().getByRole('spinbutton', { name: t('ssl.client.depth') });
    await user.clear(depth);
    await user.type(depth, '3');
    const ca = main().getByRole('textbox', { name: t('ssl.client.ca') });
    await user.click(ca);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(COMBINED);
    saveKeys();
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.client.ca'), t('ssl.pem.markerCert'))));
    expect(writesOf(admin)).toEqual([]);
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });

  it.each([
    ['an encrypted key', `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'E'.repeat(80)}\n-----END ENCRYPTED PRIVATE KEY-----\n`, 'ssl.pem.markerKey'],
    // It offers the split, so its message points at that (fix round 1, R7).
    ['a key with a certificate', SEED_KEY + SEED_CERT, 'ssl.split.held'],
  ])('the key box: Replace key, %s pasted, then Create: refused, no request, the toast names the field', async (_, text, problem) => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste(text);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.key'), t(problem))));
    expect(writesOf(admin)).toEqual([]);
  });
});

/** A whole private-key block anywhere in the markup (a textarea's text is in it too). */
const WHOLE_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/;
/** Text dropped on `target` (no file), as a browser drop of selected text does. */
const dropText = (target: Element, text: string) =>
  fireEvent.drop(target, { dataTransfer: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') } });

describe('O1: text dropped on a box that does not have focus is masked at once and held; Create / Ctrl-S refused', () => {
  const marked = (before: string) => `${before}${t('ssl.pem.marker')}\n`;

  it('the new SSL certificate box: a certificate plus a key dropped; Create sends nothing', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    const box = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    expect(box).not.toHaveFocus();
    dropText(box, RSA_LEAF + SEED_KEY);
    // Right after the drop, with no focus event at all.
    expect(box).not.toHaveFocus();
    expect(document.body.innerHTML).not.toMatch(WHOLE_KEY);
    expect(box).toHaveValue(marked(RSA_LEAF));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.cert'), t('ssl.split.held'))));
    expect(writesOf(admin)).toEqual([]);
  });

  it('the new SSL key box (no key entered yet): a key plus a certificate dropped; Create sends nothing', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}?tab=snis`, { objects: { ssls: [], routes: [], services: [] } });
    await settled();
    await user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'tls.apiseven.test{Enter}');
    await user.click(tab(t('ssl.tab.certificate')));
    await settled();
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    const box = main().getByRole('textbox', { name: t('ssl.pem.key') });
    expect(box).not.toHaveFocus();
    dropText(box, SEED_KEY + SEED_CERT);
    expect(box).not.toHaveFocus();
    expect(document.body.innerHTML).not.toMatch(WHOLE_KEY);
    expect(box).toHaveValue(`${t('ssl.pem.marker')}\n${SEED_CERT}`);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    // Held, and the key is still missing: two problems, the held one named first.
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.key'), t('ssl.split.held'), 2)));
    expect(writesOf(admin)).toEqual([]);
  });

  it('a stored CA box: a leaf plus a key dropped; Ctrl-S sends nothing', async () => {
    const withCa = { ...STORED, client: { ca: SEED_CERT, depth: 1 } };
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=client', [withCa]);
    await user.keyboard('e');
    const depth = main().getByRole('spinbutton', { name: t('ssl.client.depth') });
    await user.clear(depth);
    await user.type(depth, '3');
    const ca = main().getByRole('textbox', { name: t('ssl.client.ca') });
    expect(ca).not.toHaveFocus();
    dropText(ca, RSA_LEAF + SEED_KEY);
    expect(ca).not.toHaveFocus();
    expect(document.body.innerHTML).not.toMatch(WHOLE_KEY);
    expect(ca).toHaveValue(marked(RSA_LEAF));
    saveKeys();
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.client.ca'), t('ssl.pem.markerCert'))));
    expect(writesOf(admin)).toEqual([]);
  });

  it('the upload bar of the new SSL certificate box: the same', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    const box = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    dropText(box.closest('.ssl-pem')?.querySelector('.ssl-pem__bar') as HTMLElement, RSA_LEAF + SEED_KEY);
    expect(document.body.innerHTML).not.toMatch(WHOLE_KEY);
    expect(box).toHaveValue(marked(RSA_LEAF));
    saveKeys();
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.cert'), t('ssl.split.held'))));
    expect(writesOf(admin)).toEqual([]);
  });
});

describe('O7: after Replace key, Upload file reaches the file picker', () => {
  it('Replace key → click Upload file → choose a file: the key is taken, and Create sends it', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    const box = main().getByRole('textbox', { name: t('ssl.pem.key') });
    expect(box).toHaveFocus();
    const input = box.closest('.ssl-pem')?.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    const picker = vi.fn();
    input.addEventListener('click', picker);
    await user.click(main().getByRole('button', { name: t('ssl.pem.uploadLabel', { label: t('ssl.pem.key') }) }));
    expect(picker).toHaveBeenCalledTimes(1);
    expect(input.isConnected).toBe(true);
    await user.upload(input, new File([EC_PAIR.key], 'ec.key', { type: 'text/plain' }));
    await waitFor(() => expect(main().getByText(t('ssl.key.entered'))).toBeInTheDocument());
    expect(main().queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.key).toBe(EC_PAIR.key);
  });
});

describe('O2: a reference is taken only when it is the whole text', () => {
  it('the key box: a reference followed by a whole key is held (its key block masked when left); Create sends nothing', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste(`$secret://vault/1/ssl\n${SEED_KEY}`);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.key'), t('ssl.pem.markerKey'))));
    expect(writesOf(admin)).toEqual([]);
    expect(main().getByRole('textbox', { name: t('ssl.pem.key') })).toHaveValue(`$secret://vault/1/ssl\n${t('ssl.pem.marker')}\n`);
    expect(document.body.innerHTML).not.toContain(SEED_KEY_TEXT);
  });

  it('the certificate box: a reference followed by a certificate is held; Create sends nothing', async () => {
    const { user, admin } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    const box = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(`$secret://vault/1/ssl/cert\n${RSA_LEAF}`);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(heldToast(t('ssl.pem.cert'), t('ssl.pem.refNotAlone'))));
    expect(writesOf(admin)).toEqual([]);
    expect(box).toHaveValue(`$secret://vault/1/ssl/cert\n${RSA_LEAF}`);
  });
});

describe('a file read that finishes while a save is in flight (Task 16b, item 147; fix round 1, R3.2)', () => {
  it('changes neither the draft nor the request nor what the page shows afterwards', async () => {
    let answer: (r: Response) => void = () => {};
    const { user, admin } = await openEditor('#/ssls/~new', {
      objects: { ssls: [], routes: [], services: [] },
      replies: { ssls: (req) => (req.method === 'POST' ? new Promise<Response>((done) => (answer = done)) : undefined) },
    });
    await newSsl(user);
    const cert = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    const slow = deferredFile(new File([RSA_LEAF], 'leaf.crt', { type: 'text/plain' }), RSA_LEAF);
    fireEvent.drop(cert, { dataTransfer: { files: [slow.file], getData: () => '' } });
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await act(async () => {
      slow.release();
      await slow.file.text();
    });
    // APISIX refuses it late: the page is editable again, as it was before the save.
    act(() => answer(json(400, { error_msg: 'refused late by the test' })));
    expect(await main().findAllByText('refused late by the test')).not.toHaveLength(0);
    expect(writesOf(admin)[0]?.body?.cert).toBe(SEED_CERT);
    expect(main().getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(SEED_CERT);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]?.body?.cert).toBe(SEED_CERT);
  });
});

describe('a reference taken, then edited into something unfinished (final wave M4)', () => {
  it('discarding only the unfinished text keeps the reference: Create sends it', async () => {
    const { user, admin } = await openEditor('#/ssls/~new', { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste('$env://KEY_A');
    await user.type(main().getByRole('textbox', { name: t('ssl.pem.key') }), ' extra');
    await user.click(tab(t('ssl.tab.general')));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.discard') }));
    await settled();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ status: 1, sni: 'tls.apiseven.test', cert: SEED_CERT, key: '$env://KEY_A' });
  });
});

describe('the key box speaks of the value that stays (fix round 1, F1)', () => {
  it('a reference taken, then a combined PEM pasted over it: the split action says it replaces the key entered', async () => {
    const { user } = await openEditor('#/ssls/~new', { objects: { ssls: [], routes: [], services: [] } });
    await settled();
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste('$env://KEY_A');
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(EC_PAIR.cert + EC_PAIR.key);
    expect(main().getByRole('button', { name: t('ssl.split.toCertBoxReplacing', { what: t('ssl.split.what.key') }) })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('ssl.split.toCertBox') })).toBeNull();
  });

  it('a key entered, Replace key, a reference taken, then text added: the note names the reference, and Keep is not offered until the box is emptied', async () => {
    const { user, admin } = await openEditor('#/ssls/~new', { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste('$env://KEY_A');
    const key = main().getByRole('textbox', { name: t('ssl.pem.key') });
    await user.type(key, ' extra');
    expect(main().getByText(t('ssl.key.refStays'))).toBeInTheDocument();
    expect(main().queryByText(t('ssl.key.stays'))).toBeNull();
    expect(main().queryByRole('button', { name: t('ssl.key.keep') })).toBeNull();
    await user.clear(key);
    expect(main().getByText(t('ssl.key.stays'))).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('ssl.key.keep') }));
    expect(main().getByText(t('ssl.key.entered'))).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.key).toBe(SEED_KEY);
  });
});

describe('a CA file read that finishes after another edit (final wave M1)', () => {
  it('upload CA B at depth 1, change the depth to 2, the read finishes: the PATCH carries both', async () => {
    const withCa = { ...STORED, client: { ca: SEED_CERT, depth: 1 } };
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=client', [withCa]);
    await user.keyboard('e');
    const ca = main().getByRole('textbox', { name: t('ssl.client.ca') });
    const slow = deferredFile(new File([RSA_LEAF], 'b.crt', { type: 'text/plain' }), RSA_LEAF);
    fireEvent.drop(ca, { dataTransfer: { files: [slow.file], getData: () => '' } });
    const depth = main().getByRole('spinbutton', { name: t('ssl.client.depth') });
    await user.clear(depth);
    await user.type(depth, '2');
    await act(async () => {
      slow.release();
      await slow.file.text();
    });
    await waitFor(() => expect(ca).toHaveValue(RSA_LEAF));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.method).toBe('PATCH');
    expect(writesOf(admin)[0]?.body).toEqual({ client: { ca: RSA_LEAF, depth: 2 } });
  });
});

describe('a file dropped while a save is in flight (fix round 2, R1.1)', () => {
  it('is taken by nothing: the locked box declares no drop zone, and the box, the draft and the request agree, also after a late refusal', async () => {
    let answer: (r: Response) => void = () => {};
    const { user, admin } = await openEditor('#/ssls/~new', {
      objects: { ssls: [], routes: [], services: [] },
      replies: { ssls: (req) => (req.method === 'POST' ? new Promise<Response>((done) => (answer = done)) : undefined) },
    });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    // The certificate box, locked while the request is out: no drop zone, and a file dropped on it changes nothing.
    const box = screen.getByRole('main').querySelector('.ssl-pem') as HTMLElement;
    expect(box).not.toHaveAttribute('data-file-drop');
    const shownBefore = box.textContent;
    fireEvent.drop(box, { dataTransfer: { files: [new File([RSA_LEAF], 'leaf.crt', { type: 'text/plain' })], getData: () => '' } });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(box.textContent).toBe(shownBefore);
    act(() => answer(json(400, { error_msg: 'refused late by the test' })));
    expect(await main().findAllByText('refused late by the test')).not.toHaveLength(0);
    expect(writesOf(admin)[0]?.body?.cert).toBe(SEED_CERT);
    expect(main().getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(SEED_CERT);
    expect(main().getByRole('textbox', { name: t('ssl.pem.cert') }).closest('.ssl-pem')).toHaveAttribute('data-file-drop');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]?.body?.cert).toBe(SEED_CERT);
  });
});

describe('a split offer made by a file ends with that file’s reason (fix round 2, R1.2)', () => {
  it('a combined file dropped on the key box, then a save refused late: the key box\'s input went while locked, and the offer with its reason', async () => {
    let answer: (r: Response) => void = () => {};
    const { user, admin } = await openEditor('#/ssls/~new', {
      objects: { ssls: [], routes: [], services: [] },
      replies: { ssls: (req) => (req.method === 'POST' ? new Promise<Response>((done) => (answer = done)) : undefined) },
    });
    await newSsl(user);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    const key = main().getByRole('textbox', { name: t('ssl.pem.key') });
    fireEvent.drop(key, { dataTransfer: { files: [new File([EC_PAIR.cert + EC_PAIR.key], 'both.pem', { type: 'text/plain' })], getData: () => '' } });
    const splitAction = () => main().queryByRole('button', { name: new RegExp(`^${t('ssl.split.toCertBox').replace(/[()]/g, '\\$&')}`) });
    await waitFor(() => expect(splitAction()).toBeInTheDocument());
    expect(main().getByText(t('ssl.split.file'))).toBeInTheDocument();
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    act(() => answer(json(400, { error_msg: 'refused late by the test' })));
    expect(await main().findAllByText('refused late by the test')).not.toHaveLength(0);
    // The key box is open again (its editing state kept), with neither the file's reason nor its offer.
    expect(await main().findByRole('textbox', { name: t('ssl.pem.key') })).toBeInTheDocument();
    expect(main().queryByText(t('ssl.split.file'))).toBeNull();
    expect(splitAction()).toBeNull();
  });
});

describe('a new SSL opens without red (Task 16b, item 154)', () => {
  const certTab = () => tab(t('ssl.tab.certificate'));
  const badge = (label: string, count: number) => `${label} ${t('ui.tabs.errors', { count })}`;

  it('"A certificate is required" and "A private key is required" wait for a refused Create, or for the field to be touched', async () => {
    const { user, admin } = await openEditor('#/ssls/~new', { objects: { ssls: [], routes: [], services: [] } });
    await settled();
    for (const label of TAB_LABELS()) expect(tab(label)).toHaveAccessibleName(label);
    expect(main().queryByText(t('ssl.issue.certRequired'))).toBeNull();
    expect(main().queryByText(t('ssl.issue.keyRequired'))).toBeNull();
    // A certificate entered and taken out again: that field was touched (the draft changed there).
    const cert = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(cert);
    await user.paste(SEED_CERT);
    await user.clear(cert);
    await waitFor(() => expect(certTab()).toHaveAccessibleName(badge(t('ssl.tab.certificate'), 1)));
    expect(main().getByText(t('ssl.issue.certRequired'))).toBeInTheDocument();
    expect(main().queryByText(t('ssl.issue.keyRequired'))).toBeNull();
    // The first refused Create shows all of them.
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(certTab()).toHaveAccessibleName(badge(t('ssl.tab.certificate'), 2)));
    expect(main().getByText(t('ssl.issue.keyRequired'))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });

  it('on the JSON tab: no badge for what is only missing; a value entered there is judged at once', async () => {
    const { user, admin } = await openEditor('#/ssls/~new?tab=json', { objects: { ssls: [], routes: [], services: [] } });
    const box = await jsonEditor(t('kind.ssls.singular'));
    for (const label of TAB_LABELS()) expect(tab(label)).toHaveAccessibleName(label);
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ status: 1, sni: 'tls.apiseven.test', cert: 'not a certificate' }));
    // The certificate is a value the user gave: its problem shows; the key is still only missing.
    await waitFor(() => expect(certTab()).toHaveAccessibleName(badge(t('ssl.tab.certificate'), 1)));
    // The refused save opens the Certificate tab, where the key's problem shows too.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(await main().findByText(t('ssl.issue.keyRequired'))).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });
});

describe('a reference with white space around it (Task 16b, item 104)', () => {
  it('is taken trimmed in every box: Create sends the references without the white space', async () => {
    const { user, admin } = await openEditor('#/ssls/~new', { objects: { ssls: [], routes: [], services: [] } });
    await newSsl(user);
    const box = main().getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('  $secret://vault/1/ssl/cert\n');
    // The box keeps what was typed (only the user changes the text); its details show the reference trimmed.
    expect(box).toHaveValue('  $secret://vault/1/ssl/cert\n');
    expect(main().getByRole('definition', { name: t('ssl.cert.reference') })).toHaveTextContent(`$secret://vault/1/ssl/cert ${t('ssl.cert.ref')}`);
    await user.click(main().getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste('\t$env://SSL_KEY \n');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'POST', path: 'ssls', body: { status: 1, sni: 'tls.apiseven.test', cert: '$secret://vault/1/ssl/cert', key: '$env://SSL_KEY' } });
  });

  it('a CA reference typed with a trailing space is saved without it', async () => {
    const { user, admin } = await openSsl('#/ssls/apiseven-test?tab=client');
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: t('ssl.client.enable') }));
    await user.type(main().getByRole('textbox', { name: t('ssl.client.ca') }), '$env://CA_PEM ');
    saveKeys();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PATCH', path: 'ssls/apiseven-test', body: { client: { ca: '$env://CA_PEM' } } });
  });
});

describe('a new SSL that is not a copy', () => {
  it('has no copy notice, and the key note is neutral', async () => {
    const { user } = await openEditor(`#${newPathFor('ssls')}`, { objects: { ssls: [], routes: [], services: [] } });
    await settled();
    await user.click(main().getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    expect(main().getByText(t('ssl.key.needed'))).toBeInTheDocument();
    expect(main().queryByRole('note', { name: t('editor.copyNotice.title') })).toBeNull();
  });
});

describe('what the Client mTLS tab shows is what gets saved', () => {
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
    // The client certificate left alone is named, with the reason (Task 16b, item 87).
    expect(await screen.findByText(t('bulk.statusIgnored', { action: t('action.disable'), names: 'to-backend', reason: t('ssl.status.ignored') }))).toBeInTheDocument();
  });

  it('bulk Enable over client certificates only: nothing is written, and the toast says which were left alone and why, not "0 done"', async () => {
    const other = { ...CLIENT, id: 'to-billing' };
    const { user, admin } = await openEditor('#/ssls', { objects: { ssls: [CLIENT, other], routes: [], services: [], upstreams: [] } });
    await main().findByRole('link', { name: 'to-backend' });
    await user.click(main().getByRole('checkbox', { name: t('table.selectAll', { count: 2 }) }));
    await user.click(main().getByRole('button', { name: t('action.enable') }));
    expect(await screen.findByText(t('bulk.statusIgnored', { action: t('action.enable'), names: 'to-backend, to-billing', reason: t('ssl.status.ignored') }))).toBeInTheDocument();
    expect(screen.queryByText(t('bulk.done', { action: t('action.enable'), done: 0 }))).toBeNull();
    expect(writesOf(admin)).toEqual([]);
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
