// A public key in one comparable form, read from a certificate (its SubjectPublicKeyInfo, here,
// synchronously) or from what WebCrypto exports of a private key (a JWK, keyMatch.ts), so the two can
// be compared as strings:
// - RSA: `rsa:<modulus>:<exponent>`, hex without leading zero bytes;
// - EC: `ec:<curve>:<x>:<parity of y>`, which names the point whether the certificate writes it
//   compressed or not (a curve has two points with a given x, one with each parity of y);
// - Ed25519: `ed25519:<x>`.
// Anything else (DSA, RSA-PSS, another curve) has no form here, and is not compared.
import { BIT_STRING, bytesOf, children, hex, INTEGER, OID, oid, ofTag, SEQUENCE, type Node } from './der';

export const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
export const EC_PUBLIC_KEY = '1.2.840.10045.2.1';
export const ED25519 = '1.3.101.112';
/** The named curves WebCrypto takes, by OID. */
export const CURVES: Record<string, 'P-256' | 'P-384' | 'P-521'> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
};

/** Hex without leading zero bytes (DER's sign byte, a JWK's padding), one zero kept for zero itself. */
const unsigned = (bytes: Uint8Array): string => hex(bytes).replace(/^(?:00)+(?=.)/, '') || '00';

const rsa = (n: Uint8Array, e: Uint8Array) => `rsa:${unsigned(n)}:${unsigned(e)}`;
const ec = (curve: string, x: Uint8Array, odd: boolean) => `ec:${curve}:${unsigned(x)}:${odd ? 1 : 0}`;

/** The public key of a SubjectPublicKeyInfo element of `der`, or undefined for a kind not compared here. Throws Malformed. */
export function spkiPublicKey(der: Uint8Array, spki: Node): string | undefined {
  const [algorithm, key] = children(der, ofTag(spki, SEQUENCE));
  const [id, params] = children(der, ofTag(algorithm, SEQUENCE));
  const kind = oid(bytesOf(der, ofTag(id, OID)));
  // A BIT STRING's first byte counts the unused bits of its last byte: 0 for a key.
  const bits = bytesOf(der, ofTag(key, BIT_STRING));
  if (bits[0] !== 0) return undefined;
  const body = bits.subarray(1);
  if (kind === RSA_ENCRYPTION) {
    const at = { tag: SEQUENCE, start: 0, end: body.length };
    const [outer] = children(body, at);
    const [n, e] = children(body, ofTag(outer, SEQUENCE));
    return rsa(bytesOf(body, ofTag(n, INTEGER)), bytesOf(body, ofTag(e, INTEGER)));
  }
  if (kind === EC_PUBLIC_KEY) {
    const curve = params?.tag === OID ? CURVES[oid(bytesOf(der, params))] : undefined;
    if (!curve) return undefined;
    const form = body[0];
    if (form === 0x04 && body.length % 2 === 1) {
      const size = (body.length - 1) / 2;
      return ec(curve, body.subarray(1, 1 + size), ((body[body.length - 1] ?? 0) & 1) === 1);
    }
    if (form === 0x02 || form === 0x03) return ec(curve, body.subarray(1), form === 0x03);
    return undefined;
  }
  if (kind === ED25519) return `ed25519:${unsigned(body)}`;
  return undefined;
}

function base64url(text: string | undefined): Uint8Array | undefined {
  if (text === undefined || !/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(plain + '='.repeat((4 - (plain.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** The public key of a JWK WebCrypto exported (a private one: only its public members are read), or undefined. */
export function jwkPublicKey(jwk: JsonWebKey): string | undefined {
  if (jwk.kty === 'RSA') {
    const n = base64url(jwk.n);
    const e = base64url(jwk.e);
    return n && e ? rsa(n, e) : undefined;
  }
  if (jwk.kty === 'EC') {
    const x = base64url(jwk.x);
    const y = base64url(jwk.y);
    const curve = Object.values(CURVES).find((name) => name === jwk.crv);
    return x && y && curve ? ec(curve, x, ((y[y.length - 1] ?? 0) & 1) === 1) : undefined;
  }
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    const x = base64url(jwk.x);
    return x ? `ed25519:${unsigned(x)}` : undefined;
  }
  return undefined;
}
