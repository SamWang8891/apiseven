// The upstream's PEM fields (TLS): a file read that finishes late (final wave F1), and private-key
// material where a certificate belongs (final wave F3).
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { RSA_CA, RSA_LEAF } from '../test/certs';
import { deferredFile } from '../test/deferredFile';
import { EC_SEC1_KEY, RSA_PKCS1_KEY } from '../test/pairs';
import { renderUpstream } from '../test/upstream';
import { getToasts } from '../ui/toast';

/** The hidden file input beside the Upload button of the field labelled `label`. */
function fileInput(label: string): HTMLInputElement {
  const button = screen.getByRole('button', { name: t('up.tls.uploadLabel', { label }) });
  const input = button.parentElement?.querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no file input for ${label}`);
  return input;
}

const ca1 = () => t('up.tls.caN', { n: 1 });

async function choose(user: ReturnType<typeof renderUpstream>['user'], combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Lets a released read's promise chain run. */
async function settle(file: File) {
  await act(async () => {
    await file.text();
    await new Promise((done) => setTimeout(done, 0));
  });
}

describe('a PEM file read that finishes late (F1)', () => {
  it('is applied to the draft as it is then: an edit made meanwhile elsewhere stays', async () => {
    const h = renderUpstream({ tls: { verify: false, ca_certs: [''] } }, { section: 'tls' });
    const slow = deferredFile(new File([RSA_CA], 'ca.pem', { type: 'text/plain' }), RSA_CA);
    await h.user.upload(fileInput(ca1()), slow.file);
    await choose(h.user, t('up.tls.verify'), t('up.tls.verifyOn'));
    expect(h.value()).toEqual({ tls: { verify: true, ca_certs: [''] } });
    slow.release();
    await settle(slow.file);
    expect(h.value()).toEqual({ tls: { verify: true, ca_certs: [RSA_CA] } });
  });

  it('is stale once the field changed meanwhile: what was typed stays', async () => {
    const h = renderUpstream({ tls: { ca_certs: [''] } }, { section: 'tls' });
    const slow = deferredFile(new File([RSA_CA], 'ca.pem', { type: 'text/plain' }), RSA_CA);
    await h.user.upload(fileInput(ca1()), slow.file);
    await h.user.type(screen.getByRole('textbox', { name: ca1() }), 'typed');
    slow.release();
    await settle(slow.file);
    expect(h.value()).toEqual({ tls: { ca_certs: ['typed'] } });
    expect(screen.getByRole('textbox', { name: ca1() })).toHaveValue('typed');
  });

  it('is stale after a lock (a save in flight included), also once unlocked again', async () => {
    const h = renderUpstream({ tls: { ca_certs: [''] } }, { section: 'tls' });
    const slow = deferredFile(new File([RSA_CA], 'ca.pem', { type: 'text/plain' }), RSA_CA);
    await h.user.upload(fileInput(ca1()), slow.file);
    const changes = h.changes.mock.calls.length;
    h.update({ locked: true });
    slow.release();
    await settle(slow.file);
    h.update({ locked: false });
    expect(h.changes.mock.calls).toHaveLength(changes);
    expect(h.value()).toEqual({ tls: { ca_certs: [''] } });
  });

  it('is stale once the field is gone', async () => {
    const h = renderUpstream({ tls: { client_cert: RSA_LEAF, client_key: 'KEY' } }, { section: 'tls' });
    const slow = deferredFile(new File([RSA_LEAF], 'leaf.pem', { type: 'text/plain' }), RSA_LEAF);
    await h.user.upload(fileInput(t('up.tls.cert')), slow.file);
    const changes = h.changes.mock.calls.length;
    h.unmount();
    slow.release();
    await settle(slow.file);
    expect(h.changes.mock.calls).toHaveLength(changes);
  });
});

describe('private-key material where a certificate belongs (F3)', () => {
  // Fix round 1, R2.1: text that is in the key, so "not in the page" means something.
  const KEY_LINE = 'BEGIN RSA PRIVATE KEY';
  const KEY_BODY = RSA_PKCS1_KEY.split('\n')[1]?.slice(0, 32) ?? '';
  const keyNotIn = (html: string) => {
    expect(KEY_BODY.length).toBe(32);
    expect(RSA_PKCS1_KEY).toContain(KEY_BODY);
    expect(html).not.toContain(KEY_LINE);
    expect(html).not.toContain(KEY_BODY);
  };

  it('a stored CA entry holding a key is never shown, locked or editing, and is kept by an unrelated edit', async () => {
    const stored = { tls: { verify: true, ca_certs: [RSA_PKCS1_KEY, RSA_CA] } };
    const locked = renderUpstream(stored, { section: 'tls', locked: true, subsystem: 'stream' });
    keyNotIn(locked.container.innerHTML);
    expect(screen.getByText(t('up.tls.keyInCert'))).toBeInTheDocument();
    locked.unmount();

    const h = renderUpstream(stored, { section: 'tls', subsystem: 'stream' });
    keyNotIn(h.container.innerHTML);
    expect(screen.getByRole('textbox', { name: ca1() })).toHaveValue('');
    // A CA row has no stored value of its own to go back to (rows move): the help says only what is true.
    expect(screen.getByText(t('up.tls.keyInCertHere'))).toBeInTheDocument();
    await choose(h.user, t('up.tls.verify'), t('up.tls.verifyOff'));
    expect(h.value()).toEqual({ tls: { verify: false, ca_certs: [RSA_PKCS1_KEY, RSA_CA] } });
    expect(h.held()).toEqual([]);
  });

  // Fix round 1, R2.5: as the SSL CA box (pemBox rule 4), an emptied box puts back the stored value it can't show.
  it('a stored client certificate holding a key: typed over, then emptied, the stored value is back, never shown', async () => {
    const stored = { tls: { client_cert: RSA_PKCS1_KEY, client_key: 'KEY' } };
    const h = renderUpstream(stored, { section: 'tls' });
    const box = screen.getByRole('textbox', { name: t('up.tls.cert') });
    expect(box).toHaveValue('');
    expect(box).toHaveAccessibleDescription(t('up.tls.keyInCertKept'));
    await h.user.type(box, 'x');
    expect(h.value()).toEqual({ tls: { client_cert: 'x', client_key: 'KEY' } });
    expect(box).toHaveAccessibleDescription(t('up.tls.keyInCertBack'));
    await h.user.clear(box);
    expect(h.value()).toEqual(stored);
    expect(box).toHaveValue('');
    expect(box).toHaveAccessibleDescription(t('up.tls.keyInCertKept'));
    keyNotIn(h.container.innerHTML);
  });

  // Fix round 1, R2.4: the SSL boxes' order: the marker first, then a key (schema/secrets.ts keyMaterialIn).
  it('text holding both the marker and a key reads as the marker, as in the SSL boxes', async () => {
    const h = renderUpstream({ tls: { ca_certs: [''] } }, { section: 'tls' });
    const box = screen.getByRole('textbox', { name: ca1() });
    await h.user.click(box);
    await h.user.paste(`${t('ssl.pem.marker')}\n${EC_SEC1_KEY}`);
    expect(box).toHaveAccessibleDescription(t('ssl.pem.markerCert'));
    expect(h.value()).toEqual({ tls: { ca_certs: [''] } });
  });

  // Fix round 1, R2.8: a file that can't be read is said, at the field and in a toast; nothing changes.
  it('a file that cannot be read says so and changes nothing', async () => {
    const h = renderUpstream({ tls: { ca_certs: [RSA_CA] } }, { section: 'tls' });
    const file = new File(['x'], 'ca.pem', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('unreadable')) });
    await h.user.upload(fileInput(ca1()), file);
    await waitFor(() => expect(screen.getByRole('textbox', { name: ca1() })).toHaveAccessibleDescription(t('ssl.pem.readFailed')));
    expect(getToasts().at(-1)?.message).toBe(t('ssl.pem.readFailed'));
    expect(h.value()).toEqual({ tls: { ca_certs: [RSA_CA] } });
  });

  it('a client certificate holding a key is not shown locked either', () => {
    const h = renderUpstream({ tls: { client_cert: `${RSA_LEAF}${EC_SEC1_KEY}`, client_key: 'KEY' } }, { section: 'tls', locked: true });
    expect(h.container.textContent).not.toContain('BEGIN EC PRIVATE KEY');
    expect(screen.getByText(t('up.tls.keyInCert'))).toBeInTheDocument();
  });

  it('key material typed or pasted into a certificate field is refused: held with a reason, the value as it was, masked on leaving', async () => {
    const h = renderUpstream({ tls: { ca_certs: [RSA_CA] } }, { section: 'tls' });
    const box = screen.getByRole('textbox', { name: ca1() });
    await h.user.clear(box);
    expect(h.value()).toEqual({ tls: { ca_certs: [''] } });
    await h.user.click(box);
    await h.user.paste(EC_SEC1_KEY);
    expect(h.value()).toEqual({ tls: { ca_certs: [''] } });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(t('ssl.pem.hasKey'));
    expect(h.held()).toEqual([t('ui.pending.problem', { field: ca1(), problem: t('ssl.pem.hasKey') })]);
    // Leaving masks the key; the text stays held.
    await h.user.tab();
    expect((box as HTMLTextAreaElement).value).not.toContain('BEGIN EC PRIVATE KEY');
    expect(h.container.innerHTML).not.toContain('BEGIN EC PRIVATE KEY');
    expect(h.held()).toHaveLength(1);
    // A certificate typed in its place is taken.
    await h.user.clear(box);
    await h.user.click(box);
    await h.user.paste(RSA_CA);
    expect(h.value()).toEqual({ tls: { ca_certs: [RSA_CA] } });
    expect(h.held()).toEqual([]);
  });

  it('a file holding a key is refused for a certificate field: nothing changes, and why is said', async () => {
    const h = renderUpstream({ tls: { client_cert: RSA_LEAF, client_key: 'KEY' } }, { section: 'tls' });
    const combined = `${RSA_LEAF}${EC_SEC1_KEY}`;
    await h.user.upload(fileInput(t('up.tls.cert')), new File([combined], 'both.pem', { type: 'text/plain' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: t('up.tls.cert') })).toHaveAccessibleDescription(t('ssl.pem.fileHasKey')));
    expect(h.value()).toEqual({ tls: { client_cert: RSA_LEAF, client_key: 'KEY' } });
    expect(h.container.innerHTML).not.toContain('BEGIN EC PRIVATE KEY');
  });
});
