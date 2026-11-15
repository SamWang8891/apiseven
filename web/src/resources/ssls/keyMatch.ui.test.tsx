// Where a pair is entered, the page says whether its key belongs to its certificate (Task 16 B20):
// a new SSL, Replace certificate, an additional pair, a key entered for an additional certificate.
// A warning at most: nothing is held or refused because of it, Apply and Create stay as they were,
// and the key is in the page no more than before.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { itemOf } from '../../test/ctx';
import { main, openEditor, writesOf } from '../../test/editor';
import { EC_PAIR, EC_SEC1_KEY, RSA_OTHER_KEY, RSA_PAIR, RSA_PKCS1_KEY } from '../../test/pairs';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { CertificateTab } from './CertificateTab';
import { fingerprintOf } from './fingerprint';
import { sslIssues } from './validate';

beforeAll(async () => {
  await import('./bodies');
  await Promise.all([SEED_CERT, EC_PAIR.cert, RSA_PAIR.cert].map(fingerprintOf));
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const WHOLE_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/;
const mismatch = () => t('ssl.pair.mismatch');
const matches = () => t('ssl.pair.matches');

async function paste(user: UserEvent, scope: HTMLElement, label: string, text: string) {
  await user.click(within(scope).getByRole('textbox', { name: label }));
  await user.paste(text);
}

describe('a new SSL', () => {
  const renderNew = () => renderTab('ssls', CertificateTab, { status: 1 }, sslIssues, { isNew: true });

  it('a matching pair (RSA, the key as PKCS#1): the quiet line', async () => {
    const { user } = renderNew();
    expect(screen.getByText(t('ssl.pair.unchecked'))).toBeInTheDocument();
    await paste(user, document.body, t('ssl.pem.cert'), RSA_PAIR.cert);
    await paste(user, document.body, t('ssl.pem.key'), RSA_PKCS1_KEY);
    expect(await screen.findByText(matches())).toBeInTheDocument();
    expect(screen.queryByText(t('ssl.pair.unchecked'))).toBeNull();
  });

  it('a mismatched pair (EC): the warning in words; nothing held, no issue, and the key is not in the page', async () => {
    const { user, held, value } = renderNew();
    await paste(user, document.body, t('ssl.pem.cert'), SEED_CERT);
    await paste(user, document.body, t('ssl.pem.key'), EC_SEC1_KEY);
    expect(await screen.findByRole('note')).toHaveTextContent(mismatch());
    expect(held()).toEqual([]);
    expect(sslIssues(value(), { isNew: true, ctx: undefined as never, plugins: undefined, streamPlugins: undefined }).map((i) => i.path)).not.toContain('key');
    expect(value()).toEqual({ status: 1, cert: SEED_CERT, key: EC_SEC1_KEY });
    expect(WHOLE_KEY.test(document.body.innerHTML)).toBe(false);
  });

  it('follows the pair: another certificate after the key is compared at once; Remove the key says nothing of a match', async () => {
    const { user } = renderNew();
    await paste(user, document.body, t('ssl.pem.cert'), EC_PAIR.cert);
    await paste(user, document.body, t('ssl.pem.key'), EC_PAIR.key);
    expect(await screen.findByText(matches())).toBeInTheDocument();
    const certBox = screen.getByRole('textbox', { name: t('ssl.pem.cert') });
    await user.clear(certBox);
    await user.click(certBox);
    await user.paste(SEED_CERT);
    expect(screen.getByRole('note')).toHaveTextContent(mismatch());
    await user.click(screen.getByRole('button', { name: t('ssl.key.remove') }));
    expect(screen.queryByText(mismatch())).toBeNull();
    expect(screen.getByText(t('ssl.pair.unchecked'))).toBeInTheDocument();
  });

  it('a reference for the key: no claim either way', async () => {
    const { user } = renderNew();
    await paste(user, document.body, t('ssl.pem.cert'), SEED_CERT);
    await paste(user, document.body, t('ssl.pem.key'), '$secret://vault/1/ssl/key');
    await new Promise((done) => setTimeout(done, 20));
    expect(screen.queryByText(matches())).toBeNull();
    expect(screen.queryByText(mismatch())).toBeNull();
    expect(screen.getByText(t('ssl.pair.unchecked'))).toBeInTheDocument();
  });
});

describe('the pair dialog', () => {
  const STORED: Obj = { id: 's1', snis: ['apiseven.test'], cert: SEED_CERT };
  const renderStored = (draft: Obj = STORED) => renderTab('ssls', CertificateTab, draft, sslIssues, { original: itemOf('s1', draft) });

  it('Replace with a mismatched pair: the warning, Apply still on, and Apply hands the pair over; the tab then says it too', async () => {
    const { user, value } = renderStored();
    await user.click(screen.getByRole('button', { name: t('ssl.replace') }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
    await paste(user, dialog, t('ssl.pem.cert'), RSA_PAIR.cert);
    await paste(user, dialog, t('ssl.pem.key'), RSA_OTHER_KEY);
    expect(await within(dialog).findByText(mismatch())).toBeInTheDocument();
    const apply = within(dialog).getByRole('button', { name: t('ssl.replace.apply') });
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(value()).toEqual({ ...STORED, cert: RSA_PAIR.cert, key: RSA_OTHER_KEY });
    expect(await screen.findByText(mismatch())).toBeInTheDocument();
  });

  it('Replace with a matching pair: the quiet line', async () => {
    const { user } = renderStored();
    await user.click(screen.getByRole('button', { name: t('ssl.replace') }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.replace.title') });
    await paste(user, dialog, t('ssl.pem.cert'), RSA_PAIR.cert);
    await paste(user, dialog, t('ssl.pem.key'), RSA_PAIR.key);
    expect(await within(dialog).findByText(matches())).toBeInTheDocument();
  });

  it('Add certificate pair: the same check', async () => {
    const { user } = renderStored();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${t('ssl.extra.title')}`) }));
    await user.click(screen.getByRole('button', { name: t('ssl.extra.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.addPair.title') });
    await paste(user, dialog, t('ssl.pem.cert'), EC_PAIR.cert);
    await paste(user, dialog, t('ssl.pem.key'), SEED_KEY);
    expect(await within(dialog).findByText(mismatch())).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('ssl.addPair.apply') })).toBeEnabled();
  });

  it('Enter key for an additional certificate: compared with that certificate', async () => {
    const draft = { ...STORED, certs: [EC_PAIR.cert], keys: [null] };
    const { user } = renderStored(draft);
    await user.click(screen.getByRole('button', { name: t('ssl.extra.enterKeyFor', { n: 1 }) }));
    const dialog = await screen.findByRole('dialog', { name: t('ssl.enterKey.title') });
    await paste(user, dialog, t('ssl.pem.key'), EC_SEC1_KEY);
    expect(await within(dialog).findByText(matches())).toBeInTheDocument();
  });
});

describe('through the editor frame', () => {
  it('a mismatched pair warns and Create still sends it; the warning holds across a tab switch', async () => {
    const { user, admin } = await openEditor('#/ssls/new', { objects: { ssls: [], routes: [], services: [] } });
    const panel = await main().findByRole('tabpanel');
    await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
    await paste(user, screen.getByRole('main'), t('ssl.pem.cert'), SEED_CERT);
    await paste(user, screen.getByRole('main'), t('ssl.pem.key'), RSA_PAIR.key);
    expect(await main().findByText(mismatch())).toBeInTheDocument();
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('ssl.tab.snis')}`) }));
    await user.type(await main().findByRole('textbox', { name: t('ssl.snis.label') }), 'p.apiseven.test{Enter}');
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('ssl.tab.certificate')}`) }));
    // A remount: the verdict is still said (it is filed under the key's digest, not in the tab).
    expect(await main().findByText(mismatch())).toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toMatchObject({ method: 'POST', path: 'ssls', body: { cert: SEED_CERT, key: RSA_PAIR.key, sni: 'p.apiseven.test' } });
  });
});
