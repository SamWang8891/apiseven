// The upstream's PEM fields (TLS): a file read that finishes late (final wave F1), and private-key
// material where a certificate belongs (final wave F3).
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { RSA_CA, RSA_LEAF } from '../test/certs';
import { deferredFile } from '../test/deferredFile';
import { EC_SEC1_KEY, RSA_PKCS1_KEY } from '../test/pairs';
import { renderUpstream } from '../test/upstream';

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
  const KEY_MARK = 'MIIEowIBAAKCAQEA';

  it('a stored CA entry holding a key is never shown, locked or editing, and is kept by an unrelated edit', async () => {
    const stored = { tls: { verify: true, ca_certs: [RSA_PKCS1_KEY, RSA_CA] } };
    const locked = renderUpstream(stored, { section: 'tls', locked: true, subsystem: 'stream' });
    expect(locked.container.textContent).not.toContain(KEY_MARK);
    expect(screen.getByText(t('up.tls.keyInCert'))).toBeInTheDocument();
    locked.unmount();

    const h = renderUpstream(stored, { section: 'tls', subsystem: 'stream' });
    expect(h.container.innerHTML).not.toContain(KEY_MARK);
    expect(screen.getByRole('textbox', { name: ca1() })).toHaveValue('');
    expect(screen.getByText(t('up.tls.keyInCertKept'))).toBeInTheDocument();
    await choose(h.user, t('up.tls.verify'), t('up.tls.verifyOff'));
    expect(h.value()).toEqual({ tls: { verify: false, ca_certs: [RSA_PKCS1_KEY, RSA_CA] } });
    expect(h.held()).toEqual([]);
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
