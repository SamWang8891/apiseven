// Whether a private key belongs to its certificate (Task 16 B20). APISIX stores a mismatched pair
// (ssl.lua 131, "-- TODO: check if key & cert match"), and TLS then fails for its SNIs; so wherever a
// pair is entered the editor says what it can, never blocking anything:
// - When a key box takes a key (KeyBox, the key box's own path), `learnKey` hands its text to
//   WebCrypto: PKCS#8 as it is, PKCS#1 and SEC1 wrapped into PKCS#8 first. What comes back is only
//   the key's public part (publicKey.ts), filed under a one-way 53-bit digest of the text (`keyId`):
//   the text itself is held by nothing here, only by that promise until WebCrypto answers. Taking the
//   key never waits for it.
// - `verdictOf(cert, key)` compares that public part with the certificate's (parseCert): 'match',
//   'mismatch', or 'unknown' (a form WebCrypto can't read, a certificate our reader can't read). It
//   says nothing (undefined) when there is no pair, either side is a $secret:// / $env:// reference,
//   or the part isn't known: not derived yet, or no crypto.subtle (plain http from a LAN address).
//   As the digest is of the exact key text and the certificate is read as it is now, a result never
//   speaks for a pair that has since changed.
// - `useKeyVerdict` re-renders when a part becomes known (useSyncExternalStore): a result that
//   arrives after the page that asked is gone updates no component.
import { useSyncExternalStore } from 'react';
import { bytesOf, children, Malformed, OCTET_STRING, OID, oid, ofTag, root, SEQUENCE } from './der';
import { parseCert } from './parseCert';
import { CURVES, ED25519, EC_PUBLIC_KEY, jwkPublicKey, RSA_ENCRYPTION } from './publicKey';
import { isSecretRef } from './validate';

export type Verdict = 'match' | 'mismatch' | 'unknown';

/** A short one-way identity of a key's text (cyrb53): a map key, from which the key can't be recovered. */
function keyId(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// --- PKCS#8 from what was pasted ------------------------------------------------------------------

/** A DER element of `tag` around `parts`. */
function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((n, part) => n + part.length, 0);
  const head = length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : length < 0x10000 ? [0x82, length >> 8, length & 0xff] : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];
  const out = new Uint8Array(1 + head.length + length);
  out[0] = tag;
  out.set(head, 1);
  let at = 1 + head.length;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const VERSION_0 = Uint8Array.of(0x02, 0x01, 0x00);
/** AlgorithmIdentifier { rsaEncryption, NULL }. */
const RSA_ALGORITHM = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
/** OBJECT IDENTIFIER id-ecPublicKey. */
const EC_ALGORITHM_OID = Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01);
/** ECPrivateKey's [0] parameters. */
const EC_PARAMETERS = 0xa0;

type Algorithm = RsaHashedImportParams | EcKeyImportParams | { name: 'Ed25519' };
const RSA: Algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const ecdsa = (namedCurve: string): Algorithm => ({ name: 'ECDSA', namedCurve });

/** The key block of a taken key's text: its label (PKCS#8 '', PKCS#1 'RSA ', SEC1 'EC ', …) and DER bytes. */
function keyBlock(text: string): { label: string; der: Uint8Array<ArrayBuffer> } | undefined {
  const match = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----([\s\S]*?)-----END \1PRIVATE KEY-----/.exec(text);
  const body = match?.[2]?.replace(/\s+/g, '');
  if (!match || !body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return undefined;
  return { label: match[1] ?? '', der: Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) };
}

/** PKCS#8 bytes for WebCrypto, and the algorithm to import them as; undefined for a form not read here. Throws Malformed. */
function pkcs8Of(text: string): { der: Uint8Array<ArrayBuffer>; algorithm: Algorithm } | undefined {
  const block = keyBlock(text);
  if (!block) return undefined;
  const { label, der } = block;
  if (label === 'RSA ') return { der: tlv(SEQUENCE, VERSION_0, RSA_ALGORITHM, tlv(OCTET_STRING, der)), algorithm: RSA };
  if (label === 'EC ') {
    // ECPrivateKey { version, privateKey, [0] parameters (the curve), [1] publicKey }.
    const parts = children(der, ofTag(root(der), SEQUENCE));
    const params = parts.find((node) => node.tag === EC_PARAMETERS);
    const curveTlv = params && bytesOf(der, params);
    const curve = curveTlv && CURVES[oid(bytesOf(curveTlv, ofTag(root(curveTlv), OID)))];
    if (!curveTlv || !curve) return undefined;
    return { der: tlv(SEQUENCE, VERSION_0, tlv(SEQUENCE, EC_ALGORITHM_OID, curveTlv), tlv(OCTET_STRING, der)), algorithm: ecdsa(curve) };
  }
  if (label !== '') return undefined;
  // PrivateKeyInfo { version, AlgorithmIdentifier { algorithm, parameters }, privateKey, … }.
  const [, algorithmId] = children(der, ofTag(root(der), SEQUENCE));
  const [id, params] = children(der, ofTag(algorithmId, SEQUENCE));
  const kind = oid(bytesOf(der, ofTag(id, OID)));
  if (kind === RSA_ENCRYPTION) return { der, algorithm: RSA };
  if (kind === ED25519) return { der, algorithm: { name: 'Ed25519' } };
  const curve = kind === EC_PUBLIC_KEY && params?.tag === OID ? CURVES[oid(bytesOf(der, params))] : undefined;
  return curve ? { der, algorithm: ecdsa(curve) } : undefined;
}

/**
 * The public part of the private key in `text` (publicKey.ts), as WebCrypto derives it; the word
 * 'unreadable' for a form it can't read (no public part is written that way); undefined without
 * crypto.subtle. The exported JWK holds the private members too, for as long as this promise runs;
 * only the public part leaves it.
 */
export async function publicOfKey(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (!subtle) return undefined;
  try {
    const form = pkcs8Of(text);
    if (!form) return 'unreadable';
    const key = await subtle.importKey('pkcs8', form.der, form.algorithm, true, ['sign']);
    return jwkPublicKey(await subtle.exportKey('jwk', key)) ?? 'unreadable';
  } catch (err) {
    // A form our reader can't follow, or one WebCrypto refuses (a broken key, a curve it lacks).
    if (err instanceof Malformed || err instanceof Error) return 'unreadable';
    throw err;
  }
}

// --- What is known, and the verdict ---------------------------------------------------------------

const SIZE = 64;
/** keyId → the key's public part, or 'unreadable'. Never the key. */
const known = new Map<number, string>();
const asked = new Set<number>();
const listeners = new Set<() => void>();
let version = 0;

function file(id: number, part: string): void {
  if (known.size >= SIZE) known.delete(known.keys().next().value as number);
  known.set(id, part);
  version++;
  for (const listener of listeners) listener();
}

/**
 * A key box took `text`: derive its public part, unless it is known or on its way. Returns at once
 * with a promise of the work (tests wait on it); nothing waits on it otherwise.
 */
export function learnKey(text: string): Promise<void> {
  const id = keyId(text);
  if (known.has(id) || asked.has(id) || isSecretRef(text.trim())) return Promise.resolve();
  asked.add(id);
  return publicOfKey(text).then((part) => {
    asked.delete(id);
    if (part !== undefined) file(id, part);
  });
}

/** What can be said of the pair (cert, key), or undefined: nothing (see the head of this file). */
export function verdictOf(cert: string | undefined, key: string | undefined): Verdict | undefined {
  if (cert === undefined || key === undefined || isSecretRef(cert.trim()) || isSecretRef(key.trim())) return undefined;
  const part = known.get(keyId(key));
  if (part === undefined) return undefined;
  const ofCert = parseCert(cert)?.publicKey;
  if (part === 'unreadable' || ofCert === undefined) return 'unknown';
  return part === ofCert ? 'match' : 'mismatch';
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => version;

/** verdictOf, again whenever a key's public part becomes known. */
export function useKeyVerdict(cert: string | undefined, key: string | undefined): Verdict | undefined {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return verdictOf(cert, key);
}
