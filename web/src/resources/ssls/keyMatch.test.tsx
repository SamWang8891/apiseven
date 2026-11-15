// Whether a private key belongs to its certificate (Task 16 B20), with real pairs: WebCrypto derives
// the key's public part when the key is taken, and it is compared with the certificate's.
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EC_PAIR, EC_PARAMS_KEY, EC_SEC1_KEY, RSA_OTHER_KEY, RSA_PAIR, RSA_PKCS1_KEY } from '../../test/pairs';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { learnKey, listenerCount, publicOfKey, useKeyVerdict, verdictOf } from './keyMatch';
import { parseCert } from './parseCert';

afterEach(() => {
  vi.unstubAllGlobals();
});

const certKey = (pem: string) => parseCert(pem)?.publicKey;
/** A DSA key: a form WebCrypto has no import for. */
const DSA_KEY = '-----BEGIN DSA PRIVATE KEY-----\nMIIBuwIBAAKBgQD\n-----END DSA PRIVATE KEY-----\n';
/** A PKCS#8 block whose body is not a key at all. */
const GARBLED_KEY = `-----BEGIN PRIVATE KEY-----\n${'QUJD'.repeat(20)}\n-----END PRIVATE KEY-----\n`;

describe('the public part of a private key, as WebCrypto exports it', () => {
  it('RSA in PKCS#8 and in PKCS#1 (converted to PKCS#8): the certificate’s modulus and exponent', async () => {
    const expected = certKey(RSA_PAIR.cert);
    expect(expected).toMatch(/^rsa:[0-9A-F]+:010001$/);
    expect(await publicOfKey(RSA_PAIR.key)).toBe(expected);
    expect(await publicOfKey(RSA_PKCS1_KEY)).toBe(expected);
  });

  it('EC in PKCS#8, in SEC1 (converted), and after an EC PARAMETERS block: the certificate’s point', async () => {
    const expected = certKey(EC_PAIR.cert);
    expect(expected).toMatch(/^ec:P-256:[0-9A-F]+:[01]$/);
    expect(await publicOfKey(EC_PAIR.key)).toBe(expected);
    expect(await publicOfKey(EC_SEC1_KEY)).toBe(expected);
    expect(await publicOfKey(EC_PARAMS_KEY)).toBe(expected);
    expect(await publicOfKey(SEED_KEY)).toBe(certKey(SEED_CERT));
  });

  it('a form it cannot read: unreadable, never a guess', async () => {
    expect(await publicOfKey(DSA_KEY)).toBe('unreadable');
    expect(await publicOfKey(GARBLED_KEY)).toBe('unreadable');
  });
});

describe('the verdict on a pair', () => {
  it('a real matching pair and a real mismatched one, RSA and EC, and across kinds', async () => {
    await Promise.all([RSA_PAIR.key, RSA_PKCS1_KEY, RSA_OTHER_KEY, EC_PAIR.key, EC_SEC1_KEY, SEED_KEY].map(learnKey));
    expect(verdictOf(RSA_PAIR.cert, RSA_PAIR.key)).toBe('match');
    expect(verdictOf(RSA_PAIR.cert, RSA_PKCS1_KEY)).toBe('match');
    expect(verdictOf(RSA_PAIR.cert, RSA_OTHER_KEY)).toBe('mismatch');
    expect(verdictOf(EC_PAIR.cert, EC_SEC1_KEY)).toBe('match');
    expect(verdictOf(SEED_CERT, SEED_KEY)).toBe('match');
    expect(verdictOf(SEED_CERT, EC_PAIR.key)).toBe('mismatch');
    expect(verdictOf(RSA_PAIR.cert, EC_SEC1_KEY)).toBe('mismatch');
  });

  it('could not compare: a key form it cannot read, or a certificate it cannot read', async () => {
    await learnKey(DSA_KEY);
    await learnKey(SEED_KEY);
    expect(verdictOf(SEED_CERT, DSA_KEY)).toBe('unknown');
    expect(verdictOf('-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n', SEED_KEY)).toBe('unknown');
  });

  it('nothing to say: no pair yet, a reference on either side, or a key whose part is not known (yet)', async () => {
    await learnKey(SEED_KEY);
    expect(verdictOf(undefined, SEED_KEY)).toBeUndefined();
    expect(verdictOf(SEED_CERT, undefined)).toBeUndefined();
    expect(verdictOf('$secret://vault/1/ssl/cert', SEED_KEY)).toBeUndefined();
    expect(verdictOf(SEED_CERT, '$env://SSL_KEY')).toBeUndefined();
    // Filed under the key it came from: another key (here a key never taken) gets no verdict from it.
    const unseen = SEED_KEY.replace('-----END', '\n-----END');
    expect(verdictOf(SEED_CERT, unseen)).toBeUndefined();
  });

  it('no crypto.subtle (plain http from a LAN address): nothing is derived and nothing is said', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const key = RSA_OTHER_KEY.replace('-----END', '\n\n-----END');
    await learnKey(key);
    expect(verdictOf(RSA_PAIR.cert, key)).toBeUndefined();
  });
});

function Verdict({ cert, keyText }: { cert: string; keyText: string }) {
  return <p>{useKeyVerdict(cert, keyText) ?? 'nothing'}</p>;
}

describe('useKeyVerdict', () => {
  it('shows the verdict once the key’s part is known, and nothing before', async () => {
    const key = EC_PAIR.key.replace('-----END', '\n-----END');
    render(<Verdict cert={EC_PAIR.cert} keyText={key} />);
    expect(screen.getByText('nothing')).toBeInTheDocument();
    await act(() => learnKey(key));
    expect(screen.getByText('match')).toBeInTheDocument();
  });

  it('a result arriving after the page that asked is gone reaches no component: unmounting ends the subscription', async () => {
    const key = RSA_PAIR.key.replace('-----END', '\n\n\n-----END');
    const before = listenerCount();
    const { unmount } = render(<Verdict cert={RSA_PAIR.cert} keyText={key} />);
    expect(listenerCount()).toBe(before + 1);
    const pending = learnKey(key);
    unmount();
    expect(listenerCount()).toBe(before);
    await pending;
    // The part stays known: a page that shows the pair later says it at once.
    render(<Verdict cert={RSA_PAIR.cert} keyText={key} />);
    expect(screen.getByText('match')).toBeInTheDocument();
  });

  it('a rejection that is not an Error files the key as unreadable: no unhandled rejection, and the key is not stuck as asked (fix round 1, R10)', async () => {
    const key = EC_PAIR.key.replace('-----END', '\n\n\n\n-----END');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test: a WebCrypto that rejects with something that is not an Error
    const reject = () => Promise.reject('not an Error');
    vi.stubGlobal('crypto', { subtle: { importKey: reject, exportKey: reject } });
    await expect(learnKey(key)).resolves.toBeUndefined();
    expect(verdictOf(EC_PAIR.cert, key)).toBe('unknown');
  });
});
