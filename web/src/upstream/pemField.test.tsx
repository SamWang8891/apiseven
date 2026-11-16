// The upstream's PEM fields (TLS): a file read that finishes late (final wave F1).
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { RSA_CA, RSA_LEAF } from '../test/certs';
import { deferredFile } from '../test/deferredFile';
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
