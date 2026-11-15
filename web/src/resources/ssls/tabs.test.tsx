// The SSL editor's tabs, one at a time (renderTab: controlled by a draft, issues from sslIssues):
// the certificate details, the pair dialog, the inline pair of a new SSL, the additional pairs, the
// SNIs, mTLS and General.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { EC_IPV6, FAR, RSA_LEAF } from '../../test/certs';
import { ctxOf, itemOf } from '../../test/ctx';
import { editableControls } from '../../test/schemaForm';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
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

    const keyBox = within(dialog).getByRole('textbox', { name: t('ssl.pem.key') });
    await user.clear(keyBox);
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

  it('the key goes into the draft, leaves its box when the box is left, and never comes back as text', async () => {
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
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    await user.tab();
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
