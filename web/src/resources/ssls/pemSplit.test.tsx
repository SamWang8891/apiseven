// A combined PEM (Task 16 B23): a text or file given to either box of a pair that holds certificate
// blocks and exactly one private-key block offers one action that puts the certificates in the
// certificate box and gives the key to the key box, through each box's own path. Nothing is taken
// before that action, and no key rests in the page meanwhile. Not for the CA box, nor where a pair
// has no certificate box. And a key with lines before its first -----BEGIN line is taken from that
// line, saying the lines were left out.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { RSA_CA, RSA_LEAF } from '../../test/certs';
import { itemOf } from '../../test/ctx';
import { BAG_KEY, EC_PAIR, RSA_PAIR } from '../../test/pairs';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { CertificateTab } from './CertificateTab';
import { ClientTab } from './ClientTab';
import { fingerprintOf } from './fingerprint';
import { leftOutBefore, splitOf, takenValue, takes } from './pemBox';
import { sslIssues } from './validate';

beforeAll(async () => {
  await Promise.all([SEED_CERT, RSA_LEAF, RSA_CA, EC_PAIR.cert, RSA_PAIR.cert].map(fingerprintOf));
});

const WHOLE_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/;
/** What `openssl pkcs12 -nodes` prints: Bag Attributes, the key, then the certificate and its chain. */
const P12 = `Bag Attributes\n    localKeyID: 01 02\nKey Attributes: <No Attributes>\n${RSA_PAIR.key}Bag Attributes\n    localKeyID: 01 02\nsubject=CN=rsa-extra.apiseven.test\nissuer=CN=rsa-extra.apiseven.test\n${RSA_PAIR.cert}${RSA_CA}`;
const ENCRYPTED = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'E'.repeat(80)}\n-----END ENCRYPTED PRIVATE KEY-----\n`;

describe('splitOf', () => {
  it('certificate blocks in their order, and the one key block alone', () => {
    expect(splitOf(SEED_CERT + SEED_KEY)).toEqual({ certs: SEED_CERT, key: SEED_KEY });
    expect(splitOf(SEED_KEY + SEED_CERT)).toEqual({ certs: SEED_CERT, key: SEED_KEY });
    expect(splitOf(P12)).toEqual({ certs: RSA_PAIR.cert + RSA_CA, key: RSA_PAIR.key });
  });

  it('nothing to split: no certificate, two keys, a half key, a key the key box would not take', () => {
    expect(splitOf(SEED_KEY)).toBeUndefined();
    expect(splitOf(SEED_CERT)).toBeUndefined();
    expect(splitOf(SEED_CERT + SEED_KEY + EC_PAIR.key)).toBeUndefined();
    expect(splitOf(`${SEED_CERT}-----BEGIN PRIVATE KEY-----\nMIGH`)).toBeUndefined();
    expect(splitOf(SEED_CERT + ENCRYPTED)).toBeUndefined();
  });
});

describe('a key from its first -----BEGIN line', () => {
  it('taken, with what came before left out; white space alone is no reason to hold, nor said', () => {
    for (const text of [BAG_KEY, `# my key\n${SEED_KEY}`, `\n\n  ${SEED_KEY}`, `${SEED_KEY}\n\n`]) expect(takes('key', text), text.slice(0, 12)).toBe(true);
    expect(takenValue('key', BAG_KEY)).toBe(RSA_PAIR.key);
    expect(takenValue('key', `\n${SEED_KEY}`)).toBe(SEED_KEY);
    expect(leftOutBefore(BAG_KEY)).toBe(true);
    expect(leftOutBefore(`\n  \n${SEED_KEY}`)).toBe(false);
    expect(leftOutBefore(SEED_KEY)).toBe(false);
    // A certificate is taken as it is.
    expect(takenValue('cert', `\n${SEED_CERT}`)).toBe(`\n${SEED_CERT}`);
  });

  it('in the box: the key from its BEGIN line, the box closed, one line saying the lines before it were left out', async () => {
    const { user, value } = renderTab('ssls', CertificateTab, { status: 1, cert: RSA_PAIR.cert }, sslIssues, { isNew: true });
    await user.click(screen.getByRole('textbox', { name: t('ssl.pem.key') }));
    await user.paste(BAG_KEY);
    expect(value().key).toBe(RSA_PAIR.key);
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(screen.getByText(t('ssl.key.leftOut'))).toBeInTheDocument();
    // Replace key opens the box: the line goes with what it was about.
    await user.click(screen.getByRole('button', { name: t('ssl.key.replaceKey') }));
    expect(screen.queryByText(t('ssl.key.leftOut'))).toBeNull();
    await user.paste(`\n\n${SEED_KEY}`);
    expect(value().key).toBe(SEED_KEY);
    expect(screen.queryByText(t('ssl.key.leftOut'))).toBeNull();
  });
});

async function paste(user: UserEvent, scope: HTMLElement, label: string, text: string) {
  await user.click(within(scope).getByRole('textbox', { name: label }));
  await user.paste(text);
}
/** No whole private key in the markup, nor in a box without focus. */
function noKeyInPage() {
  expect(WHOLE_KEY.test(document.body.innerHTML)).toBe(false);
  for (const box of document.querySelectorAll('textarea')) if (box !== document.activeElement) expect(WHOLE_KEY.test(box.value)).toBe(false);
}

describe('the split, in a new SSL', () => {
  const renderNew = (draft: Obj = { status: 1 }) => renderTab('ssls', CertificateTab, draft, sslIssues, { isNew: true });

  it('pasted in the certificate box: held until the action; the action puts the certificate here and takes the key in the key box', async () => {
    const { user, value, held } = renderNew();
    const certBox = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await paste(user, document.body, t('ssl.pem.cert'), RSA_PAIR.cert + RSA_PAIR.key);
    // Nothing taken yet: the text is held, the draft as it was.
    expect(held()).toHaveLength(1);
    expect(value()).toEqual({ status: 1 });
    const action = screen.getByRole('button', { name: t('ssl.split.toKeyBox') });
    await user.click(action);
    expect(certBox).toHaveValue(RSA_PAIR.cert);
    expect(value()).toEqual({ status: 1, cert: RSA_PAIR.cert, key: RSA_PAIR.key });
    expect(held()).toEqual([]);
    expect(screen.queryByRole('textbox', { name: t('ssl.pem.key') })).toBeNull();
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('ssl.split.toKeyBox') })).toBeNull();
    noKeyInPage();
    // The pair's check runs on the key taken this way too.
    expect(await screen.findByText(t('ssl.pair.matches'))).toBeInTheDocument();
  });

  it('a combined file dropped on the certificate box: refused as before (nothing in the box), and the split offered; the action works', async () => {
    const { user, value } = renderNew();
    const certBox = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    const file = new File([P12], 'export.pem', { type: 'text/plain' });
    fireEvent.drop(certBox, { dataTransfer: { files: [file], getData: () => '' } });
    expect(await screen.findByRole('button', { name: t('ssl.split.toKeyBox') })).toBeInTheDocument();
    expect(certBox).toHaveValue('');
    expect(value()).toEqual({ status: 1 });
    expect(certBox).toHaveAccessibleDescription(expect.stringContaining(t('ssl.split.file')) as string);
    noKeyInPage();
    await user.click(screen.getByRole('button', { name: t('ssl.split.toKeyBox') }));
    expect(certBox).toHaveValue(RSA_PAIR.cert + RSA_CA);
    expect(value()).toEqual({ status: 1, cert: RSA_PAIR.cert + RSA_CA, key: RSA_PAIR.key });
    // The box changed: the file's reason goes with it (rule 5), and nothing says the box holds a problem.
    expect(certBox).not.toHaveAccessibleDescription(expect.stringContaining(t('ssl.pem.fileHasKey')) as string);
    expect(certBox).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('given to the key box: the action takes the key there and puts the certificate in the certificate box; it says when it replaces a key', async () => {
    const { user, value } = renderNew({ status: 1, cert: SEED_CERT, key: SEED_KEY });
    await user.click(screen.getByRole('button', { name: t('ssl.key.replaceKey') }));
    await user.paste(EC_PAIR.key + EC_PAIR.cert);
    // Left (the focus moves on): its key block is a marker at once, and the offer still stands.
    await user.tab();
    noKeyInPage();
    expect(value()).toEqual({ status: 1, cert: SEED_CERT, key: SEED_KEY });
    await user.click(screen.getByRole('button', { name: t('ssl.split.toCertBoxReplacing', { what: t('ssl.split.what.both') }) }));
    expect(value()).toEqual({ status: 1, cert: EC_PAIR.cert, key: EC_PAIR.key });
    expect(screen.getByRole('textbox', { name: t('ssl.pem.cert') })).toHaveValue(EC_PAIR.cert);
    expect(screen.getByText(t('ssl.key.entered'))).toBeInTheDocument();
  });

  it('the certificate box says the key it gives replaces an entered one', async () => {
    const { user } = renderNew({ status: 1, key: SEED_KEY });
    await paste(user, document.body, t('ssl.pem.cert'), SEED_CERT + EC_PAIR.key);
    expect(screen.getByRole('button', { name: t('ssl.split.toKeyBoxReplacing', { what: t('ssl.split.what.key') }) })).toBeInTheDocument();
  });

  it('while the split is offered, the messages point at it, not at doing it by hand: the key box after Tab, a refused combined file (fix round 1, R7)', async () => {
    const { user } = renderNew({ status: 1, cert: SEED_CERT });
    const key = screen.getByRole('textbox', { name: t('ssl.pem.key') });
    await user.click(key);
    await user.paste(EC_PAIR.key + EC_PAIR.cert);
    await user.tab();
    expect(key).not.toHaveFocus();
    expect(key).toHaveAccessibleDescription(t('ssl.split.held'));
    expect(key).not.toHaveAccessibleDescription(expect.stringContaining(t('ssl.pem.markerKey')) as string);
    expect(screen.getByRole('button', { name: t('ssl.split.toCertBoxReplacing', { what: t('ssl.split.what.cert') }) })).toBeInTheDocument();

    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    fireEvent.drop(cert, { dataTransfer: { files: [new File([P12], 'export.pem', { type: 'text/plain' })], getData: () => '' } });
    await waitFor(() => expect(cert).toHaveAccessibleDescription(expect.stringContaining(t('ssl.split.file')) as string));
    expect(cert).not.toHaveAccessibleDescription(expect.stringContaining(t('ssl.pem.fileHasKey')) as string);
  });

  it('the action says what it replaces: a certificate in the certificate box, even unfinished text, and a key (fix round 1, R8)', async () => {
    const { user, value } = renderNew();
    await user.type(screen.getByRole('textbox', { name: t('ssl.pem.cert') }), '-----BEGIN CERTIFICATE-----');
    await paste(user, document.body, t('ssl.pem.key'), EC_PAIR.key + EC_PAIR.cert);
    await user.click(screen.getByRole('button', { name: t('ssl.split.toCertBoxReplacing', { what: t('ssl.split.what.cert') }) }));
    expect(value()).toEqual({ status: 1, cert: EC_PAIR.cert, key: EC_PAIR.key });
    // The certificate box's own action, over a certificate taken and with a key entered.
    const cert = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    fireEvent.drop(cert, { dataTransfer: { files: [new File([P12], 'export.pem', { type: 'text/plain' })], getData: () => '' } });
    await user.click(await screen.findByRole('button', { name: t('ssl.split.toKeyBoxReplacing', { what: t('ssl.split.what.both') }) }));
    expect(value()).toEqual({ status: 1, cert: RSA_PAIR.cert + RSA_CA, key: RSA_PAIR.key });
  });

  it('the offer goes when the text changes, and nothing is offered for what cannot be split', async () => {
    const { user } = renderNew();
    await paste(user, document.body, t('ssl.pem.cert'), SEED_CERT + SEED_KEY);
    expect(screen.getByRole('button', { name: t('ssl.split.toKeyBox') })).toBeInTheDocument();
    // A change that still leaves a certificate and its key keeps the offer; one that doesn't ends it.
    await user.keyboard('x');
    expect(screen.getByRole('button', { name: t('ssl.split.toKeyBox') })).toBeInTheDocument();
    await user.keyboard('{Control>}a{/Control}y');
    expect(screen.queryByRole('button', { name: t('ssl.split.toKeyBox') })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: t('ssl.pem.cert') }));
    await user.paste(SEED_CERT + ENCRYPTED);
    expect(screen.queryByRole('button', { name: t('ssl.split.toKeyBox') })).toBeNull();
  });
});

describe('the split in the pair dialog, and where it is not offered', () => {
  const STORED: Obj = { id: 's1', snis: ['apiseven.test'], cert: SEED_CERT };

  it('Replace certificate: the action fills both boxes; Apply hands the pair over', async () => {
    const { user, value } = renderTab('ssls', CertificateTab, STORED, sslIssues, { original: itemOf('s1', STORED) });
    await user.click(screen.getByRole('button', { name: t('ssl.replace') }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
    const apply = within(dialog).getByRole('button', { name: t('ssl.replace.apply') });
    await paste(user, dialog, t('ssl.pem.cert'), P12);
    expect(apply).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: t('ssl.split.toKeyBox') }));
    await waitFor(() => expect(apply).toBeEnabled());
    await user.click(apply);
    expect(value()).toEqual({ ...STORED, cert: RSA_PAIR.cert + RSA_CA, key: RSA_PAIR.key });
  });

  it('not in the CA box, nor in the key box of Enter key (it has no certificate box)', async () => {
    const draft = { ...STORED, client: {} };
    const ca = renderTab('ssls', ClientTab, draft, sslIssues, { original: itemOf('s1', draft) });
    await paste(ca.user, document.body, t('ssl.client.ca'), SEED_CERT + SEED_KEY);
    expect(screen.queryByRole('button', { name: /^Use the/ })).toBeNull();
    ca.unmount();

    const withExtra = { ...STORED, certs: [EC_PAIR.cert], keys: [null] };
    const { user } = renderTab('ssls', CertificateTab, withExtra, sslIssues, { original: itemOf('s1', withExtra) });
    await user.click(screen.getByRole('button', { name: t('ssl.extra.enterKeyFor', { n: 1 }) }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.enterKey.title') });
    await paste(user, dialog, t('ssl.pem.key'), EC_PAIR.key + EC_PAIR.cert);
    expect(within(dialog).queryByRole('button', { name: /^Use the/ })).toBeNull();
  });
});
