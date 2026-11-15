// X.509 certificate details from PEM, with a minimal DER reader (der.ts): pure, synchronous, no
// dependencies. It reads what the dashboard shows (names, SANs, validity, serial, the public key a
// private key is compared with) and verifies nothing.
import { BOOLEAN, bytesOf, children, fail, hex, INTEGER, Malformed, OCTET_STRING, OID, oid, ofTag, readNode, SEQUENCE, SET, type Node } from './der';
import { spkiPublicKey } from './publicKey';

export interface CertInfo {
  subject: string;
  issuer: string;
  /** dNSName and iPAddress entries of subjectAltName, in certificate order. */
  sans: string[];
  /** The dNSName entries alone, in order: the names a client can send as SNI (an address is not one). */
  dns: string[];
  /** Milliseconds since the epoch. */
  notBefore: number;
  notAfter: number;
  /** Uppercase hex, without DER's sign byte (as `openssl x509 -serial` prints it). */
  serial: string;
  /** Its public key as publicKey.ts writes one (keyMatch compares it); undefined for a kind not compared (DSA, RSA-PSS…). */
  publicKey: string | undefined;
}

const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;
const VERSION = 0xa0; // [0] EXPLICIT
const EXTENSIONS = 0xa3; // [3] EXPLICIT
const DNS_NAME = 0x82; // [2] IMPLICIT IA5String
const IP_ADDRESS = 0x87; // [7] IMPLICIT OCTET STRING

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

const utf8 = new TextDecoder();

/** A directory string; other value types come out as `#` + hex, as RFC 4514 writes them. */
function text(der: Uint8Array, node: Node): string {
  const bytes = bytesOf(der, node);
  switch (node.tag) {
    case 0x0c: // UTF8String
      return utf8.decode(bytes);
    case 0x13: // PrintableString
    case 0x16: // IA5String
    case 0x14: // TeletexString: Latin-1 in practice
      return latin1(bytes);
    case 0x1e: {
      // BMPString: UTF-16 big-endian
      if (bytes.length % 2 !== 0) fail();
      let out = '';
      for (let i = 0; i < bytes.length; i += 2) {
        out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
      }
      return out;
    }
    default:
      return `#${hex(bytes)}`;
  }
}

const ATTRIBUTES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
};

/** `CN=…, O=…` in certificate order; unknown attribute types by their dotted OID. */
function name(der: Uint8Array, node: Node): string {
  const parts: string[] = [];
  for (const rdn of children(der, ofTag(node, SEQUENCE))) {
    for (const atv of children(der, ofTag(rdn, SET))) {
      const [type, value] = children(der, ofTag(atv, SEQUENCE));
      const id = oid(bytesOf(der, ofTag(type, OID)));
      parts.push(`${ATTRIBUTES[id] ?? id}=${text(der, value ?? fail())}`);
    }
  }
  return parts.join(', ');
}

/** UTCTime (two-digit year: 50–99 → 19xx, else 20xx, RFC 5280) or GeneralizedTime, in UTC. */
function time(der: Uint8Array, node: Node): number {
  const value = latin1(bytesOf(der, node));
  const match =
    node.tag === UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(value)
      : node.tag === GENERALIZED_TIME
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(value)
        : null;
  if (!match) fail();
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const year = node.tag === UTC_TIME ? (y >= 50 ? 1900 + y : 2000 + y) : y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) fail();
  return Date.UTC(year, mo - 1, d, h, mi, s);
}

function ip(bytes: Uint8Array): string | undefined {
  if (bytes.length === 4) return [...bytes].join('.');
  if (bytes.length !== 16) return undefined;
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  return groups.join(':');
}

const SUBJECT_ALT_NAME = '2.5.29.17';

function subjectAltNames(der: Uint8Array, extensions: Node | undefined): { sans: string[]; dns: string[] } {
  const none = { sans: [], dns: [] };
  if (!extensions) return none;
  const [list] = children(der, extensions);
  for (const extension of children(der, ofTag(list, SEQUENCE))) {
    const parts = children(der, ofTag(extension, SEQUENCE));
    if (oid(bytesOf(der, ofTag(parts[0], OID))) !== SUBJECT_ALT_NAME) continue;
    // extnID, optional critical BOOLEAN, extnValue OCTET STRING wrapping GeneralNames.
    const value = ofTag(parts[1]?.tag === BOOLEAN ? parts[2] : parts[1], OCTET_STRING);
    const [names] = children(der, value);
    const sans: string[] = [];
    const dns: string[] = [];
    for (const general of children(der, ofTag(names, SEQUENCE))) {
      // Other name forms (email, URI, directory name…) are not host names.
      if (general.tag === DNS_NAME) {
        const host = latin1(bytesOf(der, general));
        sans.push(host);
        dns.push(host);
      }
      const address = general.tag === IP_ADDRESS ? ip(bytesOf(der, general)) : undefined;
      if (address !== undefined) sans.push(address);
    }
    return { sans, dns };
  }
  return none;
}

/** The certificate's public key; a key it can't read leaves the rest of the certificate readable. */
function publicKeyOf(der: Uint8Array, spki: Node): string | undefined {
  try {
    return spkiPublicKey(der, spki);
  } catch (err) {
    if (err instanceof Malformed) return undefined;
    throw err;
  }
}

function parseDer(der: Uint8Array): CertInfo {
  const certificate = ofTag(readNode(der, 0, der.length), SEQUENCE);
  if (certificate.end !== der.length) fail();
  const [tbs] = children(der, certificate);
  const fields = children(der, ofTag(tbs, SEQUENCE));
  // v1 certificates have no version field.
  const rest = fields[0]?.tag === VERSION ? fields.slice(1) : fields;
  const [serialNode, signature, issuerNode, validityNode, subjectNode, publicKey, ...optional] = rest;
  ofTag(signature, SEQUENCE);
  ofTag(publicKey, SEQUENCE);
  const [notBefore, notAfter] = children(der, ofTag(validityNode, SEQUENCE));

  let serial = bytesOf(der, ofTag(serialNode, INTEGER));
  if (serial.length === 0) fail();
  // A positive integer whose top bit is set carries a leading 00 sign byte.
  if (serial.length > 1 && serial[0] === 0 && (serial[1] ?? 0) & 0x80) serial = serial.subarray(1);

  const { sans, dns } = subjectAltNames(der, optional.find((node) => node.tag === EXTENSIONS));
  return {
    publicKey: publicKeyOf(der, publicKey ?? fail()),
    subject: name(der, subjectNode ?? fail()),
    issuer: name(der, issuerNode ?? fail()),
    sans,
    dns,
    notBefore: time(der, notBefore ?? fail()),
    notAfter: time(der, notAfter ?? fail()),
    serial: hex(serial),
  };
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([^-]*)-----END CERTIFICATE-----/;

/** The DER bytes of the first certificate block, or undefined when there is none or its base64 is broken. */
function firstDer(pem: string): Uint8Array<ArrayBuffer> | undefined {
  const body = PEM_BLOCK.exec(pem)?.[1]?.replace(/\s+/g, '');
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return undefined;
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

const CACHE_SIZE = 200;
const cache = new Map<string, CertInfo | undefined>();

/**
 * The first certificate in `pem`, or undefined for anything it cannot read. Never throws. Results
 * are memoised per PEM string (lists call this per row on every render) and frozen: don't mutate them.
 */
export function parseCert(pem: string): CertInfo | undefined {
  if (cache.has(pem)) return cache.get(pem);
  let info: CertInfo | undefined;
  try {
    const der = firstDer(pem);
    info = der && parseDer(der);
  } catch {
    info = undefined;
  }
  if (info) {
    Object.freeze(info.sans);
    Object.freeze(info.dns);
    Object.freeze(info);
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(pem, info);
  return info;
}

/**
 * SHA-256 of the first certificate's DER, as uppercase hex pairs joined by `:` (openssl's
 * `-fingerprint -sha256`). Undefined without a readable block, or where the browser offers no
 * crypto.subtle (it does only in secure contexts: https or localhost).
 */
export async function fingerprintSha256(pem: string): Promise<string | undefined> {
  const der = firstDer(pem);
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (!der || !subtle) return undefined;
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', der));
    return hex(digest).replace(/(..)(?!$)/g, '$1:');
  } catch {
    return undefined;
  }
}
