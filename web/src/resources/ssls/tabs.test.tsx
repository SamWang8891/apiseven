// The SSL editor's tabs, one at a time (renderTab: controlled by a draft, issues from sslIssues):
// the certificate details, the pair dialog, the inline pair of a new SSL, the additional pairs, the
// SNIs, mTLS and General.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { EC_IPV6, FAR, RSA_LEAF, V1 } from '../../test/certs';
import { ctxOf, itemOf } from '../../test/ctx';
import { editableControls } from '../../test/schemaForm';
import { BAG_KEY, EC_PAIR, EC_PARAMS_KEY } from '../../test/pairs';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { getToasts } from '../../ui/toast';
import { CertificateTab } from './CertificateTab';
import { ClientTab } from './ClientTab';
import { fingerprintOf } from './fingerprint';
import { GeneralTab } from './GeneralTab';
import { SnisTab } from './SnisTab';
import { sslIssues } from './validate';

beforeAll(async () => {
  await Promise.all([SEED_CERT, RSA_LEAF, EC_IPV6, FAR].map(fingerprintOf));
});

const KEY_TEXT = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg59GD85BzOUzXl7Hu';
const STORED: Obj = { id: 's1', snis: ['apiseven.test'], cert: SEED_CERT };
const stored = itemOf('s1', STORED);
const renderSsl = (Tab: Parameters<typeof renderTab>[1], draft: Obj, opts: Parameters<typeof renderTab>[4] = {}) =>
  renderTab('ssls', Tab, draft, sslIssues, { original: opts.isNew ? undefined : stored, ...opts });

/** What a box's field says under it (its error line), or undefined. */
const said = (box: HTMLElement) => box.closest('.ui-field')?.querySelector('.ui-field__error')?.textContent ?? undefined;

async function openReplace(user: ReturnType<typeof renderSsl>['user']) {
  await user.click(screen.getByRole('button', { name: t('ssl.replace') }));
  return screen.findByRole('dialog', { name: t('ssl.replace.title') });
}

describe('CertDetails on the Certificate tab', () => {
  it("shows the seed certificate's subject, names, expiry and fingerprint", () => {
    renderSsl(CertificateTab, STORED, { locked: true });
    const region = screen.getByRole('region', { name: t('ssl.cert.region') });
    expect(within(region).getByRole('definition', { name: t('ssl.cert.sans') })).toHaveTextContent('apiseven.test*.apiseven.test');
    expect(within(region).getByRole('definition', { name: t('ssl.cert.notAfter') }).querySelector('.ui-badge')).toHaveClass('expiry--ok');
    expect(within(region).getByRole('definition', { name: t('ssl.cert.fingerprint') })).toHaveTextContent(/^A4:EE:54:/);
  });

  it('a $secret:// reference shows as what it is; a certificate our reader cannot read says so', () => {
    renderSsl(CertificateTab, { ...STORED, cert: '$secret://vault/1/ssl/cert' }, { locked: true });
    expect(screen.getByRole('definition', { name: t('ssl.cert.reference') })).toHaveTextContent(`$secret://vault/1/ssl/cert ${t('ssl.cert.ref')}`);
  });

  it('an unreadable certificate: the note, and the rest works (the key line)', () => {
    renderSsl(CertificateTab, { ...STORED, cert: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(200)}\n-----END CERTIFICATE-----` }, { locked: true });
    expect(screen.getByRole('note')).toHaveTextContent(t('ssl.cert.unreadable'));
    expect(screen.getByRole('definition', { name: t('ssl.key.label') })).toHaveTextContent(t('ssl.key.stored'));
  });

  it('locked: details only, no form controls and no Replace', () => {
    const draft = { ...STORED, certs: [RSA_LEAF] };
    const { container } = renderSsl(CertificateTab, draft, { locked: true, original: itemOf('s1', draft) });
    expect(editableControls(container)).toEqual([]);
    expect(screen.queryByRole('button', { name: t('ssl.replace') })).toBeNull();
    expect(screen.getByRole('listitem', { name: t('ssl.extra.row', { n: 1 }) })).toHaveTextContent(t('ssl.extra.stored'));
  });
});

describe('the pair dialog (Replace certificate)', () => {
  it('text with no PEM label is refused as typed and Apply stays off; the same for a key, or a certificate in the key box', async () => {
    const { user, changes } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const apply = within(dialog).getByRole('button', { name: t('ssl.replace.apply') });
    await user.type(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }), 'garbage');
    expect(within(dialog).getByText(t('ssl.pem.noCertLabel'))).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    expect(apply).toBeDisabled();

    // The key was taken whole: Replace key opens an empty box for another try.
    await user.click(within(dialog).getByRole('button', { name: t('ssl.key.replaceKey') }));
    const keyBox = within(dialog).getByRole('textbox', { name: t('ssl.pem.key') });
    await user.type(keyBox, 'not a key');
    expect(within(dialog).getByText(t('ssl.pem.noKeyLabel'))).toBeInTheDocument();
    await user.clear(keyBox);
    await user.click(keyBox);
    await user.paste(SEED_CERT);
    expect(within(dialog).getByText(t('ssl.pem.isCert'))).toBeInTheDocument();
    expect(apply).toBeDisabled();
    expect(changes).not.toHaveBeenCalled();
  });

  it('a labelled certificate our reader cannot read is still taken: a note says APISIX will judge it', async () => {
    const { user, value } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const odd = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(200)}\n-----END CERTIFICATE-----\n`;
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(odd);
    expect(within(dialog).getByRole('note')).toHaveTextContent(t('ssl.cert.unreadable'));
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
    expect(value()).toEqual({ ...STORED, cert: odd, key: SEED_KEY });
  });

  it('shows the new certificate and what changes: expiry and names, now and after', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(RSA_LEAF);
    const compare = within(dialog).getByRole('region', { name: t('ssl.pair.compare') });
    expect(within(compare).getByRole('definition', { name: t('ssl.cert.sans') })).toHaveTextContent(`${t('ssl.pair.before')}: apiseven.test*.apiseven.test${t('ssl.pair.after')}: example.org*.example.org10.0.0.1`);
    expect(within(dialog).getAllByRole('definition', { name: t('ssl.cert.subject') })[0]).toHaveTextContent('CN=example.org');
  });

  it('uploading a file fills its box', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input[type="file"]');
    await user.upload(inputs[0] as HTMLInputElement, new File([RSA_LEAF], 'leaf.crt', { type: 'text/plain' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(RSA_LEAF));
    expect(within(dialog).getByRole('button', { name: t('ssl.pem.uploadLabel', { label: t('ssl.pem.cert') }) })).toBeInTheDocument();
  });

  it('a file dropped on a box fills it', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const box = within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') });
    const zone = box.closest('.ssl-pem') as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('ssl-pem--over');
    fireEvent.drop(zone, { dataTransfer: { files: [new File([FAR], 'far.pem', { type: 'text/plain' })], getData: () => '' } });
    await waitFor(() => expect(box).toHaveValue(FAR));
    expect(zone).not.toHaveClass('ssl-pem--over');
  });

  it('the key is never shown after Apply: the key line says it will be replaced', async () => {
    const { user, value } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(value().key).toBe(SEED_KEY);
    expect(screen.getByRole('definition', { name: t('ssl.key.label') })).toHaveTextContent(t('ssl.key.replaced'));
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });
});

describe('a new SSL: the pair inline', () => {
  it('certificate text with no PEM label holds Save and leaves the draft as it was; a certificate is taken', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1 }, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.type(box, 'oops');
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.noCertLabel') })]);
    expect(value()).toEqual({ status: 1 });
    await user.clear(box);
    await user.click(box);
    await user.paste(SEED_CERT);
    expect(held()).toEqual([]);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
  });

  it('the key goes into the draft, leaves its box at once, and never comes back as text; Replace key stays open until Keep', async () => {
    const { user, value, lock } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await user.click(screen.getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    expect(value().key).toBe(SEED_KEY);
    await user.tab();
    expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    lock(true);
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    lock(false);

    // Replace key opens an empty box (the entered key stays in the draft until another is taken).
    await user.click(screen.getByRole('button', { name: t('ssl.key.replaceKey') }));
    const box = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    // The empty box says the key entered before still stands.
    expect(screen.getByText(t('ssl.key.stays'))).toBeInTheDocument();
    // Leaving it does not close it (rule 9); Keep the entered key does.
    await user.tab();
    expect(screen.getByRole('textbox', { name: t('ssl.pem.key') })).toBe(box);
    await user.click(screen.getByRole('button', { name: t('ssl.key.keep') }));
    expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(value().key).toBe(SEED_KEY);
    await user.click(screen.getByRole('button', { name: t('ssl.key.remove') }));
    expect(value()).not.toHaveProperty('key');
    expect(screen.getByRole('textbox', { name: t('ssl.pem.key') })).toBeInTheDocument();
  });
});

describe('additional pairs', () => {
  const withPairs = { ...STORED, certs: [RSA_LEAF, EC_IPV6] };
  const original = itemOf('s1', withPairs);

  it('adding a pair through the dialog asks for the stored keys again, and says so per pair', async () => {
    const { user, value } = renderSsl(CertificateTab, withPairs, { original });
    expect(screen.getByRole('listitem', { name: t('ssl.extra.row', { n: 1 }) })).toHaveTextContent(t('ssl.extra.stored'));
    await user.click(screen.getByRole('button', { name: t('ssl.extra.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.addPair.title') });
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(FAR);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.addPair.apply') }));
    expect(value()).toEqual({ ...withPairs, certs: [RSA_LEAF, EC_IPV6, FAR], keys: [null, null, SEED_KEY] });
    expect(screen.getByRole('listitem', { name: t('ssl.extra.row', { n: 1 }) })).toHaveTextContent(t('ssl.extra.needed'));
    expect(screen.getByRole('listitem', { name: t('ssl.extra.row', { n: 3 }) })).toHaveTextContent(t('ssl.extra.entered'));
    expect(screen.getAllByText(t('ssl.issue.keyMissing', { n: 1 })).length).toBeGreaterThan(0);
  });

  it('"Enter key" takes the key of that certificate only (shown, not editable, in the dialog)', async () => {
    const { user, value } = renderSsl(CertificateTab, { ...withPairs, keys: [null, null] }, { original });
    await user.click(screen.getByRole('button', { name: t('ssl.extra.enterKeyFor', { n: 2 }) }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.enterKey.title') });
    expect(within(dialog).queryByRole('textbox', { name: t('ssl.pem.cert') })).toBeNull();
    expect(within(dialog).getByRole('definition', { name: t('ssl.cert.sans') })).toHaveTextContent('v6.example.org');
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.enterKey.apply') }));
    expect(value().keys).toEqual([null, SEED_KEY]);
  });

  it('removing the first pair keeps the second on its own row; removing the last of a stored set sends keys: []', async () => {
    const { user, value } = renderSsl(CertificateTab, withPairs, { original });
    await user.click(screen.getByRole('button', { name: t('ssl.extra.remove', { n: 1 }) }));
    expect(value()).toEqual({ ...STORED, certs: [EC_IPV6], keys: [null] });
    expect(screen.getByRole('listitem', { name: t('ssl.extra.row', { n: 1 }) })).toHaveTextContent('v6.example.org');
    await user.click(screen.getByRole('button', { name: t('ssl.extra.remove', { n: 1 }) }));
    expect(value()).toEqual({ ...STORED, keys: [] });
  });
});

describe('a private key arriving whole leaves the page at once (no blur needed)', () => {
  const NEW = { status: 1, cert: SEED_CERT };
  const keyFile = () => new File([SEED_KEY], 'tls.key', { type: 'text/plain' });
  const gone = async (value: () => Obj) => {
    await waitFor(() => expect(value().key).toBe(SEED_KEY));
    expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  };

  it('uploaded into the new SSL key box', async () => {
    const { user, container, value } = renderSsl(CertificateTab, NEW, { isNew: true });
    await user.upload(container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1] as HTMLInputElement, keyFile());
    await gone(value);
  });

  it('dropped on the new SSL key box', async () => {
    const { value } = renderSsl(CertificateTab, NEW, { isNew: true });
    const zone = screen.getByRole('textbox', { name: t('ssl.pem.key') }).closest('.ssl-pem') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [keyFile()], getData: () => '' } });
    await gone(value);
  });

  it('pasted whole (with its END line), before the box is left', async () => {
    const { user, value } = renderSsl(CertificateTab, NEW, { isNew: true });
    await user.click(screen.getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    await gone(value);
  });

  it('uploaded in the Replace dialog: the dialog shows it entered, not the text; Apply takes it', async () => {
    const { user, value } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await user.upload(dialog.querySelectorAll<HTMLInputElement>('input[type="file"]')[1] as HTMLInputElement, keyFile());
    await waitFor(() => expect(within(dialog).getByText(t('ssl.key.entered'))).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
    expect(value()).toEqual({ ...STORED, cert: SEED_CERT, key: SEED_KEY });
  });
});

describe('S1: a key counts as taken only when it is whole (BEGIN and END lines, or a reference)', () => {
  const HALF = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49';
  const fill = async (user: ReturnType<typeof renderSsl>['user'], box: HTMLElement, text: string) => {
    await user.click(box);
    await user.paste(text);
  };

  it('dialog: a half key is not taken (Apply off, held); cleared, nothing stands', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await fill(user, within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }), SEED_CERT);
    const key = within(dialog).getByRole('textbox', { name: t('ssl.pem.key') });
    await fill(user, key, HALF);
    expect(within(dialog).getByText(t('ssl.pem.incomplete'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
    await user.clear(key);
    expect(within(dialog).queryByText(t('ssl.key.entered'))).toBeNull();
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
  });

  it('dialog: after a whole key, Replace key and a half key: the earlier key stands and the box says so; cleared, it is the one applied', async () => {
    const { user, value } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await fill(user, within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }), SEED_CERT);
    await fill(user, within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }), SEED_KEY);
    await user.click(within(dialog).getByRole('button', { name: t('ssl.key.replaceKey') }));
    const key = within(dialog).getByRole('textbox', { name: t('ssl.pem.key') });
    await user.type(key, '-----BEGIN PRIVATE KEY-----');
    expect(within(dialog).getByText(t('ssl.key.stays'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
    await user.clear(key);
    expect(within(dialog).getByText(t('ssl.key.stays'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
    expect(value()).toEqual({ ...STORED, cert: SEED_CERT, key: SEED_KEY });
  });

  it('new SSL: a half key typed and cleared leaves no key; left in the box, it is held (its key block a marker), not taken', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await user.type(key, '-----BEGIN PRIVATE KEY-----');
    expect(value()).not.toHaveProperty('key');
    expect(screen.getByText(t('ssl.key.none'))).toBeInTheDocument();
    await user.clear(key);
    expect(value()).not.toHaveProperty('key');
    expect(screen.queryByText(t('ssl.key.entered'))).toBeNull();
    expect(screen.getByText(t('ssl.key.none'))).toBeInTheDocument();
    await fill(user, key, HALF);
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.key'), problem: t('ssl.pem.incomplete') })]);
    await user.tab();
    expect(key).toHaveValue(t('ssl.pem.marker'));
    expect(value()).not.toHaveProperty('key');
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.key'), problem: t('ssl.pem.markerKey') })]);
    expect(screen.getByText(t('ssl.key.none'))).toBeInTheDocument();
  });

  it('rule 6: a whole key with anything else after it (a certificate, a second key) is not taken', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    for (const text of [SEED_KEY + SEED_CERT, SEED_KEY + SEED_KEY]) {
      await user.clear(key);
      await fill(user, key, text);
      expect(value()).not.toHaveProperty('key');
      expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.key'), problem: t('ssl.pem.notOneKey') })]);
    }
  });

  it('a reference is whole as typed: it is the key', async () => {
    const { user, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await user.type(screen.getByRole('textbox', { name: t('ssl.pem.key') }), '$secret://vault/1/ssl/key');
    expect(value().key).toBe('$secret://vault/1/ssl/key');
  });
});

describe('S3: a refused file leaves the box and the draft as they were', () => {
  const COMBINED = SEED_CERT + SEED_KEY;
  const upload = async (user: ReturnType<typeof renderSsl>['user'], scope: HTMLElement, at: number, file: File) =>
    user.upload(scope.querySelectorAll<HTMLInputElement>('input[type="file"]')[at] as HTMLInputElement, file);

  it('new SSL: a combined file on a box that holds a certificate', async () => {
    const { user, container, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await upload(user, container, 0, new File([COMBINED], 'both.pem'));
    expect(await screen.findByText(t('ssl.pem.fileHasKey'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(SEED_CERT);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('the CA box, editing a stored CA', async () => {
    const stored = { ...STORED, client: { ca: SEED_CERT } };
    const { user, container, value } = renderSsl(ClientTab, stored);
    await upload(user, container, 0, new File([COMBINED], 'both.pem'));
    expect(await screen.findByText(t('ssl.pem.fileHasKey'))).toBeInTheDocument();
    expect(value()).toEqual(stored);
  });

  it('the key box: a file that is not a whole key', async () => {
    const { user, container, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await upload(user, container, 1, new File([SEED_CERT], 'cert.pem'));
    const box = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await waitFor(() => expect(said(box)?.startsWith(t('ssl.pem.fileRefused', { problem: t('ssl.pem.isCert') }))).toBe(true));
    expect(box).toHaveValue('');
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
  });

  it('a file with no PEM label leaves a certificate box as it was (case 1)', async () => {
    const { user, container, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await upload(user, container, 0, new File(['hello world'], 'notes.txt', { type: 'text/plain' }));
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await waitFor(() => expect(said(box)).toBe(t('ssl.pem.fileRefused', { problem: t('ssl.pem.noCertLabel') })));
    expect(box).toHaveValue(SEED_CERT);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
  });

  it("a refused file's reason shows even when the box already shows a problem, the file's first (case 2)", async () => {
    const { user, container, value } = renderSsl(CertificateTab, { status: 1 }, { isNew: true });
    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.type(cert, 'abc');
    await upload(user, container, 0, new File([COMBINED], 'both.pem'));
    await waitFor(() => expect(said(cert)).toBe(`${t('ssl.pem.fileHasKey')} ${t('ssl.pem.noCertLabel')}`));
    expect(cert).toHaveValue('abc');
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await user.click(key);
    await user.paste('-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49');
    // Reaching Upload leaves the box: the half key is a marker now, still held.
    await upload(user, container, 1, new File([SEED_CERT], 'cert.pem'));
    await waitFor(() => expect(said(key)).toBe(`${t('ssl.pem.fileRefused', { problem: t('ssl.pem.isCert') })} ${t('ssl.pem.markerKey')}`));
    expect(key).toHaveValue(t('ssl.pem.marker'));
    expect(value()).toEqual({ status: 1 });
    // Until the box next changes.
    await user.type(cert, 'd');
    expect(said(cert)).toBe(t('ssl.pem.noCertLabel'));
  });

  it('combined text pasted over a certificate is held, the certificate kept and said so; leaving turns its key block into a marker and it stays held', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    // Pasted over the whole text in one go: the draft keeps its certificate meanwhile (held).
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(COMBINED);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
    expect(screen.getByText(t('ssl.box.keptCert'))).toBeInTheDocument();
    await user.tab();
    expect(box).toHaveValue(SEED_CERT + `${t('ssl.pem.marker')}\n`);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.markerCert') })]);
    expect(screen.getByText(t('ssl.box.keptCert'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });
});

describe('S2 and S4: a box never shows a stored text that holds a key, and says what the draft keeps', () => {
  const COMBINED = SEED_CERT + SEED_KEY;

  it('Replace CA: the empty box says the stored CA stays, and Keep the stored CA closes it', async () => {
    const stored = { ...STORED, client: { ca: COMBINED } };
    const { user, value } = renderSsl(ClientTab, stored, { original: itemOf('s1', stored) });
    await user.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
    expect(screen.getByRole('textbox', { name: t('ssl.client.ca') })).toHaveValue('');
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('ssl.client.keepCa') }));
    expect(screen.queryByRole('textbox', { name: t('ssl.client.ca') })).toBeNull();
    expect(screen.getByRole('button', { name: t('ssl.client.replaceCa') })).toBeInTheDocument();
    expect(value()).toEqual(stored);
  });

  it("a new SSL whose draft certificate (from the JSON tab) holds a key: an empty box and a note that it stays, the key not on the page", () => {
    renderSsl(CertificateTab, { status: 1, cert: COMBINED }, { isNew: true });
    expect(screen.getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue('');
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('(a) over that draft certificate, typing and deleting again returns to exactly that state; so does a certificate entered and emptied', async () => {
    const { user, value } = renderSsl(CertificateTab, { status: 1, cert: COMBINED }, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.type(box, 'x');
    expect(value()).toEqual({ status: 1, cert: COMBINED });
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    await user.type(box, '{Backspace}');
    expect(value()).toEqual({ status: 1, cert: COMBINED });
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    await user.click(box);
    await user.paste(RSA_LEAF);
    expect(value()).toEqual({ status: 1, cert: RSA_LEAF });
    expect(screen.queryByText(t('ssl.box.hiddenStays'))).toBeNull();
    await user.clear(box);
    expect(value()).toEqual({ status: 1, cert: COMBINED });
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('(b) Replace CA over a stored CA that holds a key, a valid CA entered, then the box emptied: the stored CA stays, the note and Keep are back', async () => {
    const stored = { ...STORED, client: { ca: COMBINED } };
    const { user, value } = renderSsl(ClientTab, stored, { original: itemOf('s1', stored) });
    await user.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
    const box = screen.getByRole('textbox', { name: t('ssl.client.ca') });
    await user.click(box);
    await user.paste(RSA_LEAF);
    expect(value()).toEqual({ ...STORED, client: { ca: RSA_LEAF } });
    expect(screen.queryByText(t('ssl.box.hiddenStays'))).toBeNull();
    await user.clear(box);
    expect(value()).toEqual(stored);
    expect(screen.getByText(t('ssl.box.hiddenStays'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('ssl.client.keepCa') })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('(c) rule 8: while held, the box says once what is kept, and nothing says the box shows what will be saved', async () => {
    const stored = { ...STORED, client: { ca: COMBINED } };
    const { user } = renderSsl(ClientTab, stored, { original: itemOf('s1', stored) });
    await user.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
    const box = screen.getByRole('textbox', { name: t('ssl.client.ca') });
    await user.type(box, 'abc');
    expect(said(box)).toBe(t('ssl.pem.noCertLabel'));
    const notes = [t('ssl.box.hiddenStays'), t('ssl.box.keptCert'), t('ssl.box.keptNone')].filter((n) => screen.queryByText(n) !== null);
    expect(notes).toEqual([t('ssl.box.hiddenStays')]);
  });
});

describe('files are checked before they are read', () => {
  const pick = async (user: ReturnType<typeof renderSsl>['user'], dialog: HTMLElement, file: File) =>
    user.upload(dialog.querySelectorAll<HTMLInputElement>('input[type="file"]')[0] as HTMLInputElement, file);

  it('a file over 64 KiB is refused at the field, unread', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const big = new File(['A'.repeat(70 * 1024)], 'big.pem', { type: 'text/plain' });
    const read = vi.spyOn(big, 'text');
    await pick(user, dialog, big);
    expect(await within(dialog).findByText(t('ssl.pem.tooBig', { size: '70 KiB' }))).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue('');
  });

  it('a binary file (DER) is named as such, and nothing goes in the box', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    // A .crt is often DER.
    await pick(user, dialog, new File([new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01, 0x00, 0xff])], 'cert.crt'));
    expect(await within(dialog).findByText(t('ssl.pem.binary'))).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue('');
  });

  it('a read that fails says so at the field and in a toast, with nothing of the file', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const broken = new File(['SECRET-CONTENT'], 'cert.pem');
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('SECRET-CONTENT unreadable'));
    await pick(user, dialog, broken);
    expect(await within(dialog).findByText(t('ssl.pem.readFailed'))).toBeInTheDocument();
    expect(getToasts().at(-1)?.message).toBe(t('ssl.pem.readFailed'));
    expect(document.body.innerHTML).not.toContain('SECRET-CONTENT');
  });
});

describe('a certificate box never takes a private key (a combined PEM)', () => {
  const COMBINED = SEED_CERT + SEED_KEY;

  it('pasted in the dialog: held as typed (Apply off); when the box is left, its key block is a marker and it stays held', async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    const box = within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.paste(COMBINED);
    expect(within(dialog).getByText(t('ssl.pem.hasKey'))).toBeInTheDocument();
    expect(within(dialog).getByText(t('ssl.box.keptNone'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    expect(box).toHaveValue(SEED_CERT + `${t('ssl.pem.marker')}\n`);
    expect(within(dialog).getByText(t('ssl.pem.markerCert'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('(d) rule 7: plain text dropped on a box is a paste, never called a file', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    box.focus();
    fireEvent.drop(box.closest('.ssl-pem') as HTMLElement, { dataTransfer: { files: [], getData: () => COMBINED } });
    expect(box).toHaveValue(COMBINED);
    expect(said(box)).toBe(t('ssl.pem.hasKey'));
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.hasKey') })]);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
    await user.tab();
    expect(box).toHaveValue(SEED_CERT + `${t('ssl.pem.marker')}\n`);
    fireEvent.drop(box.closest('.ssl-pem') as HTMLElement, { dataTransfer: { files: [], getData: () => RSA_LEAF } });
    expect(value()).toEqual({ status: 1, cert: RSA_LEAF });
    expect(held()).toEqual([]);
  });

  it('uploaded in the new SSL certificate box: never shown, nothing taken', async () => {
    const { user, container, value } = renderSsl(CertificateTab, { status: 1 }, { isNew: true });
    await user.upload(container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0] as HTMLInputElement, new File([COMBINED], 'both.pem'));
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await waitFor(() => expect(said(box)?.startsWith(t('ssl.pem.fileHasKey'))).toBe(true));
    expect(box).toHaveValue('');
    expect(value()).toEqual({ status: 1 });
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('typed in the new SSL certificate box: holds Save (the draft keeps what it had); leaving turns the key block into a marker, still held', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1 }, { isNew: true });
    const box = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.click(box);
    await user.paste(COMBINED);
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.hasKey') })]);
    expect(value()).toEqual({ status: 1 });
    await user.tab();
    expect(box).toHaveValue(SEED_CERT + `${t('ssl.pem.marker')}\n`);
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.markerCert') })]);
    expect(value()).toEqual({ status: 1 });
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('an encrypted key, or other refused key material, in the key box: held, and leaving makes it a marker, never cleared', async () => {
    const ENCRYPTED = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'E'.repeat(80)}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
    for (const [text, problem] of [
      [ENCRYPTED, t('ssl.pem.encrypted')],
      [SEED_KEY + SEED_CERT, t('ssl.pem.notOneKey')],
    ] as const) {
      const { user, value, held, unmount } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT, key: EC_PAIR.key }, { isNew: true });
      await user.click(screen.getByRole('button', { name: t('ssl.key.replaceKey') }));
      const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
      await user.paste(text);
      expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.key'), problem })]);
      expect(screen.getByText(t('ssl.key.stays'))).toBeInTheDocument();
      await user.tab();
      expect(key).toHaveValue(text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/, t('ssl.pem.marker')));
      expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.key'), problem: t('ssl.pem.markerKey') })]);
      expect(value()).toEqual({ status: 1, cert: SEED_CERT, key: EC_PAIR.key });
      expect(document.body.innerHTML).not.toContain(KEY_TEXT);
      unmount();
    }
  });

  it('a stored SSL whose cert, extra cert or CA already holds a key: a warning in words, and no key text on the page', () => {
    const stored = { ...STORED, cert: COMBINED, certs: [COMBINED], client: { ca: COMBINED } };
    const original = itemOf('s1', stored);
    renderSsl(CertificateTab, stored, { locked: true, original });
    expect(screen.getAllByText(t('ssl.cert.holdsKey'))).toHaveLength(2);
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('the CA field, locked and editing: the warning, no key text, and Replace CA for a clean one', async () => {
    const stored = { ...STORED, client: { ca: COMBINED } };
    const view = renderSsl(ClientTab, stored, { locked: true, original: itemOf('s1', stored) });
    expect(screen.getByText(t('ssl.cert.holdsKey'))).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    view.lock(false);
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    await view.user.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
    expect(screen.getByRole('textbox', { name: t('ssl.client.ca') })).toHaveValue('');
  });
});

describe('fix round 4: what a box takes, what it masks, and when it opens or closes', () => {
  const HALF = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49';
  const marker = t('ssl.pem.marker');
  const paste = async (user: ReturnType<typeof renderSsl>['user'], box: HTMLElement, text: string) => {
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(text);
  };
  const dropNothing = (target: Element) => fireEvent.drop(target, { dataTransfer: { files: [], getData: () => '' } });
  const keyHeld = (problem: string) => [t('ui.pending.problem', { field: t('ssl.pem.key'), problem })];

  it('O4: a half key followed by a certificate or a whole key: leaving masks the key blocks only, the rest stays', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await paste(user, cert, `${HALF}\n${RSA_LEAF}`);
    await user.tab();
    expect(cert).toHaveValue(`${marker}\n${RSA_LEAF}`);
    expect(value().cert).toBe(SEED_CERT);
    expect(held()).toEqual([t('ui.pending.problem', { field: t('ssl.pem.cert'), problem: t('ssl.pem.markerCert') })]);
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await paste(user, key, `${HALF}\n${SEED_KEY}`);
    await user.tab();
    expect(key).toHaveValue(`${marker}\n${marker}\n`);
    await paste(user, key, `${HALF}\n${RSA_LEAF}`);
    await user.tab();
    expect(key).toHaveValue(`${marker}\n${RSA_LEAF}`);
    expect(value()).not.toHaveProperty('key');
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('O5: a drop with neither a file nor text changes nothing', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    dropNothing(cert);
    expect(cert).toHaveValue(SEED_CERT);
    expect(value()).toEqual({ status: 1, cert: SEED_CERT });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await paste(user, key, HALF);
    dropNothing(key.closest('.ssl-pem') as HTMLElement);
    expect(key).toHaveValue(HALF);
    expect(held()).toEqual(keyHeld(t('ssl.pem.incomplete')));
  });

  it('O6: the key box takes one key with what OpenSSL skips around it (an EC PARAMETERS block, lines after the key), typed or as a file', async () => {
    for (const text of [EC_PARAMS_KEY, `${EC_PAIR.key}# rotated in November\n`]) {
      const { user, value, unmount } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
      await paste(user, screen.getByRole('textbox', { name: t('ssl.pem.key') }), text);
      expect(value().key).toBe(text);
      expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
      expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
      unmount();
    }
    const { user, container, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    await user.upload(container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1] as HTMLInputElement, new File([EC_PARAMS_KEY], 'ec.key', { type: 'text/plain' }));
    await waitFor(() => expect(value().key).toBe(EC_PARAMS_KEY));
  });

  it('O6: text before the first -----BEGIN line (Bag Attributes, a comment, a blank line) is refused, as APISIX refuses it; typed or as a file', async () => {
    const { user, container, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    for (const text of [BAG_KEY, `# my key\n${SEED_KEY}`, `\n${SEED_KEY}`]) {
      await paste(user, key, text);
      expect(held()).toEqual(keyHeld(t('ssl.pem.keyNotFirst')));
      expect(value()).not.toHaveProperty('key');
    }
    await user.clear(key);
    await user.upload(container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1] as HTMLInputElement, new File([BAG_KEY], 'tls.pem', { type: 'text/plain' }));
    // The file's reason first (the key is still required, which the field says after it).
    await waitFor(() => expect(said(key)?.startsWith(t('ssl.pem.fileRefused', { problem: t('ssl.pem.keyNotFirst') }))).toBe(true));
    expect(key).toHaveValue('');
    expect(value()).not.toHaveProperty('key');
  });

  it('6″: a reference is taken only as the whole text, in a key box and in a certificate box', async () => {
    const { user, value, held } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT }, { isNew: true });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    for (const ref of ['$secret://vault/1/ssl/key', '$ENV://SSL_KEY', '$env://ssl_key']) {
      await paste(user, key, ref);
      expect(value().key).toBe(ref);
      expect(held()).toEqual([]);
    }
    for (const text of ['$secret://vault/1/ssl key', '$env://SSL_KEY\nmore', `$secret://vault/1/ssl\n${SEED_KEY}`]) {
      await paste(user, key, text);
      expect(value()).not.toHaveProperty('key');
      expect(held()).toEqual(keyHeld(t('ssl.pem.refNotAlone')));
    }
    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await paste(user, cert, '$secret://vault/1/ssl/cert');
    expect(value().cert).toBe('$secret://vault/1/ssl/cert');
    await paste(user, cert, `$secret://vault/1/ssl/cert\n${RSA_LEAF}`);
    expect(value().cert).toBe('$secret://vault/1/ssl/cert');
    expect(said(cert)).toBe(t('ssl.pem.refNotAlone'));
  });

  it('9: Replace key opens a box that stays open when left, until Keep the entered key (or a whole key) closes it', async () => {
    const { user, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT, key: EC_PAIR.key }, { isNew: true });
    await user.click(screen.getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.tab();
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    expect(key).not.toHaveFocus();
    expect(screen.getByText(t('ssl.key.stays'))).toBeInTheDocument();
    // A reference taken in the box stays shown when the box is left.
    await paste(user, key, '$secret://vault/1/ssl/key');
    await user.tab();
    expect(key).toHaveValue('$secret://vault/1/ssl/key');
    expect(value().key).toBe('$secret://vault/1/ssl/key');
    await user.click(screen.getByRole('button', { name: t('ssl.key.keep') }));
    expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(value().key).toBe(EC_PAIR.key);
  });

  it('O7: Replace key → click Upload file reaches the picker → the chosen key is taken; the same in the dialog', async () => {
    const { user, value } = renderSsl(CertificateTab, { status: 1, cert: SEED_CERT, key: EC_PAIR.key }, { isNew: true });
    const pick = async (scope: HTMLElement, file: File) => {
      await user.click(within(scope).getByRole('button', { name: t('ssl.key.replaceKey') }));
      const box = within(scope).getByRole('textbox', { name: t('ssl.pem.key') });
      const input = box.closest('.ssl-pem')?.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
      const picker = vi.fn();
      input.addEventListener('click', picker);
      await user.click(within(scope).getByRole('button', { name: t('ssl.pem.uploadLabel', { label: t('ssl.pem.key') }) }));
      expect(picker).toHaveBeenCalledTimes(1);
      await user.upload(input, file);
    };
    await pick(document.body, new File([SEED_KEY], 'tls.key', { type: 'text/plain' }));
    await waitFor(() => expect(value().key).toBe(SEED_KEY));
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();

    const stored = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(stored.user);
    await stored.user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await stored.user.paste(EC_PAIR.key);
    await pick(dialog, new File([SEED_KEY], 'tls.key', { type: 'text/plain' }));
    await waitFor(() => expect(within(dialog).getByText(t('ssl.key.entered'))).toBeInTheDocument());
    await stored.user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }));
    await stored.user.paste(SEED_CERT);
    await stored.user.click(within(dialog).getByRole('button', { name: t('ssl.replace.apply') }));
    expect(stored.value()).toEqual({ ...STORED, cert: SEED_CERT, key: SEED_KEY });
  });

  it("1′: text dropped on the dialog's certificate box without focus is masked at once, and Apply stays off", async () => {
    const { user } = renderSsl(CertificateTab, STORED);
    const dialog = await openReplace(user);
    await user.click(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(SEED_KEY);
    const cert = within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') });
    expect(cert).not.toHaveFocus();
    fireEvent.drop(cert, { dataTransfer: { files: [], getData: () => SEED_CERT + SEED_KEY } });
    expect(cert).toHaveValue(`${SEED_CERT}${marker}\n`);
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
    expect(within(dialog).getByRole('button', { name: t('ssl.replace.apply') })).toBeDisabled();
  });
});

describe('additional pairs of a client certificate', () => {
  it('are hidden when it has none, and shown when the draft has keys but no certs (from the JSON tab)', () => {
    const client = { type: 'client', cert: SEED_CERT };
    const none = renderSsl(CertificateTab, client, { original: itemOf('s1', client) });
    expect(screen.queryByRole('region', { name: t('ssl.extra.title') })).toBeNull();
    none.unmount();
    renderSsl(CertificateTab, { ...client, keys: ['K'] }, { original: itemOf('s1', client) });
    expect(screen.getByRole('region', { name: t('ssl.extra.title') })).toBeInTheDocument();
  });
});

describe('the SNIs tab', () => {
  it('"Use SANs from certificate" takes its DNS names only, wildcards kept; several go in snis, one in sni', async () => {
    const leaf = renderSsl(SnisTab, { cert: RSA_LEAF, sni: 'old.test' });
    await leaf.user.click(screen.getByRole('button', { name: t('ssl.snis.useSans') }));
    // RSA_LEAF also names the IP 10.0.0.1, which no client sends as SNI.
    expect(leaf.value()).toEqual({ cert: RSA_LEAF, snis: ['example.org', '*.example.org'] });
    leaf.unmount();
    const far = renderSsl(SnisTab, { cert: FAR, snis: ['a.test', 'b.test'] });
    await far.user.click(screen.getByRole('button', { name: t('ssl.snis.useSans') }));
    expect(far.value()).toEqual({ cert: FAR, sni: 'far.example.org' });
  });

  it('refuses a name the schema refuses, and a wildcard that is not *. as typed', async () => {
    const { user, value, held } = renderSsl(SnisTab, { cert: SEED_CERT, snis: ['a.test'] });
    const box = screen.getByRole('textbox', { name: t('ssl.snis.label') });
    await user.type(box, '*foo.test{Enter}');
    expect(held()).toEqual([t('ui.pending.tag', { field: t('ssl.snis.label'), text: '*foo.test', reason: t('ssl.sni.wildcard') })]);
    await user.clear(box);
    await user.type(box, '*.foo.test{Enter}');
    expect(value()).toEqual({ cert: SEED_CERT, snis: ['a.test', '*.foo.test'] });
  });

  it('names another enabled server certificate with one of the same SNIs; not while the list loads', () => {
    const ctx = ctxOf({ ssls: [stored, itemOf('twin', { snis: ['apiseven.test'] }), itemOf('off', { snis: ['apiseven.test'], status: 0 })] });
    renderSsl(SnisTab, STORED, { ctx });
    expect(screen.getByRole('note')).toHaveTextContent(t('ssl.snis.shared', { names: 'twin' }));
  });

  it('says nothing of other certificates while the SSL list loads', () => {
    renderSsl(SnisTab, STORED, { ctx: ctxOf({ ssls: [], loaded: { ssls: false } }) });
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe("the SNIs tab says what the certificate's names are only when it can read them", () => {
  it.each([
    ['a reference', { cert: '$secret://vault/1/cert' }, 'ssl.snis.sansRef'],
    ['an unreadable certificate', { cert: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(200)}\n-----END CERTIFICATE-----` }, 'ssl.snis.sansUnreadable'],
    ['a certificate without DNS names', { cert: V1 }, 'ssl.snis.noSans'],
  ])('%s', (_, draft, key) => {
    renderSsl(SnisTab, { ...draft, sni: 'a.test' });
    expect(screen.getByText(t(key))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('ssl.snis.useSans') })).toBeDisabled();
  });

  it('nothing at all before there is a certificate', () => {
    const { container } = renderSsl(SnisTab, { sni: 'a.test' });
    expect(container).not.toHaveTextContent(t('ssl.snis.noSans'));
    expect(container).not.toHaveTextContent(t('ssl.snis.sansRef'));
  });
});

describe('the Client mTLS tab', () => {
  it('the switch adds client and removes it with what it holds; clearing a field keeps client', async () => {
    const { user, value } = renderSsl(ClientTab, STORED);
    await user.click(screen.getByRole('switch', { name: t('ssl.client.enable') }));
    expect(value()).toEqual({ ...STORED, client: {} });
    await user.type(screen.getByRole('spinbutton', { name: t('ssl.client.depth') }), '2');
    expect(value()).toEqual({ ...STORED, client: { depth: 2 } });
    await user.clear(screen.getByRole('spinbutton', { name: t('ssl.client.depth') }));
    expect(value()).toEqual({ ...STORED, client: {} });
    await user.click(screen.getByRole('switch', { name: t('ssl.client.enable') }));
    expect(value()).toEqual(STORED);
  });

  it('locked: the CA reads as its details, an unset depth as its default', () => {
    renderSsl(ClientTab, { ...STORED, client: { ca: SEED_CERT } }, { locked: true });
    expect(screen.getByRole('definition', { name: t('ssl.cert.subject') })).toHaveTextContent('CN=apiseven.test');
    expect(screen.getByText(t('ssl.client.depthDefault'))).toBeInTheDocument();
  });
});

describe('the General tab', () => {
  it('type, and the TLS protocols as boxes: none checked removes the key (APISIX default)', async () => {
    const { user, value } = renderSsl(GeneralTab, STORED);
    await user.click(screen.getByRole('checkbox', { name: 'TLSv1.3' }));
    expect(value()).toEqual({ ...STORED, ssl_protocols: ['TLSv1.3'] });
    await user.click(screen.getByRole('checkbox', { name: 'TLSv1.2' }));
    expect(value().ssl_protocols).toEqual(['TLSv1.2', 'TLSv1.3']);
    await user.click(screen.getByRole('checkbox', { name: 'TLSv1.2' }));
    await user.click(screen.getByRole('checkbox', { name: 'TLSv1.3' }));
    expect(value()).toEqual(STORED);
    await user.click(screen.getByRole('radio', { name: t('ssl.type.client') }));
    expect(value()).toEqual({ ...STORED, type: 'client' });
    expect(screen.getByText(t('ssl.status.ignored'))).toBeInTheDocument();
  });

  it('locked with no protocols reads as the APISIX default', () => {
    renderSsl(GeneralTab, STORED, { locked: true });
    expect(screen.getByText(t('ssl.general.protocolsDefault'))).toBeInTheDocument();
  });
});
