/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { EC_IPV6, FAR, NO_SAN, RSA_CA, RSA_LEAF, STRINGS, V1 } from '../../test/certs';
import { fingerprintOf, knownFingerprint } from './fingerprint';
import { fingerprintSha256, parseCert } from './parseCert';

// Vite refuses imports from outside web/, so read the seed script from disk.
const seedScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../dev/seed.mjs'), 'utf8');

/** The certificate dev/seed.mjs installs as SSL `apiseven-test`. */
const SEED = /`(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\s*)`/.exec(seedScript)?.[1] ?? '';

/** From the seed script too: a key, which is not a certificate. */
const PRIVATE_KEY = /`(-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----\s*)`/.exec(seedScript)?.[1] ?? '';

function derOf(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

function pemOf(der: Uint8Array): string {
  const body = btoa(String.fromCharCode(...der)).replace(/.{64}/g, '$&\n');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

describe('parseCert', () => {
  it('reads an RSA certificate signed by a CA', () => {
    expect(parseCert(RSA_LEAF)).toEqual({
      subject: 'C=TW, ST=Taipei, L=Xinyi, O=Example Org, OU=Platform, CN=example.org, 1.2.840.113549.1.9.1=ops@example.org',
      issuer: 'C=TW, O=apiseven test CA, CN=apiseven Test Root',
      sans: ['example.org', '*.example.org', '10.0.0.1'],
      // The dNSName entries alone, for SNIs: an iPAddress SAN is not a name a client sends.
      dns: ['example.org', '*.example.org'],
      ips: ['10.0.0.1'],
      notBefore: Date.UTC(2026, 10, 14, 13, 47, 19),
      notAfter: Date.UTC(2029, 1, 16, 13, 47, 19),
      // DER pads it with a 00 sign byte; openssl prints it without.
      serial: '8F0102030405060708',
      // As `openssl x509 -modulus` prints it, and the exponent 65537.
      publicKey: 'rsa:DE3EB5012A5C718EB7AF77AECFFC9F7B4BA7761CB2AC5CC6EADFA9E93550DE205AF2A38DB5BF00B338CEEF453F458F70DA5128454383687EF3626A2A419F038A8B45F141F3BF54F7AC722953860A59C6548F53B14C417D92AA1FB659FD4932EA5A8C26FF50E0D401C84581E42E3EB41575A7C296652BBB70BE20E2092232C1942B83C116DFA1A11939792F97560A58F64D1879FA82CF96F0604D2A1FC3DB3937F7334B14DFB9B40936CF05BDFF2C4C26E446E87433ADA1C5915D0638BD67A5F72E59F9DF8F276236B2CA10FFE589EF8EC1F2336CA4CC628678ACF96503B824D01E7A300CE4081DFBF15B5D93A2E1673F451B1A7BD394FB2DE70054C8CE0371CD:010001',
    });
  });

  it('reads an ECDSA certificate with IPv6 SANs, skipping email and URI entries', () => {
    expect(parseCert(EC_IPV6)).toEqual({
      subject: 'CN=v6.example.org',
      issuer: 'CN=v6.example.org',
      sans: ['v6.example.org', '2001:db8:0:0:0:0:0:1', '0:0:0:0:0:0:0:1'],
      dns: ['v6.example.org'],
      ips: ['2001:db8:0:0:0:0:0:1', '0:0:0:0:0:0:0:1'],
      notBefore: Date.UTC(2026, 10, 14, 13, 47, 19),
      notAfter: Date.UTC(2027, 10, 14, 13, 47, 19),
      serial: '33526D2BE28720DC9D9C3A06F0D2419CA59D2372',
      // The point's x as `openssl pkey -pubin` writes it, and its y odd.
      publicKey: 'ec:P-256:F6FDB0FB55050357EC805AD37578231DF4CD909E9266BF8417CFB89B1B2E14E4:1',
    });
  });

  it('gives no SANs for a certificate without the extension', () => {
    expect(parseCert(NO_SAN)).toEqual({
      subject: 'O=No SAN Inc, CN=nosan.internal',
      issuer: 'O=No SAN Inc, CN=nosan.internal',
      sans: [],
      dns: [],
      ips: [],
      notBefore: Date.UTC(2026, 10, 14, 13, 47, 19),
      notAfter: Date.UTC(2026, 11, 14, 13, 47, 19),
      serial: '093D4197ABDF488125E64A61AAD9B714CF039F5E',
      publicKey: 'ec:P-256:1E89871A7F117F01EAF94460F2B35E223AC91731B2E8DE5C4B679E50C60BCB64:1',
    });
  });

  it('reads an X.509 v1 certificate, which has no version field and no extensions', () => {
    expect(parseCert(V1)).toEqual({
      subject: 'CN=v1.example.org',
      issuer: 'CN=v1.example.org',
      sans: [],
      dns: [],
      ips: [],
      notBefore: Date.UTC(2026, 10, 14, 13, 47, 54),
      notAfter: Date.UTC(2027, 10, 14, 13, 47, 54),
      serial: '6D0F7F424DA7E92B009EFA077EBAB30B18B229A7',
      publicKey: 'ec:P-256:B06FB7C3845282D683D15229DC56A7A9BC5C7497405B5D159C682FB8FD26C6AF:0',
    });
  });

  it('reads UTCTime with the 1950 pivot and GeneralizedTime from 2050 on', () => {
    expect(parseCert(FAR)).toMatchObject({
      sans: ['far.example.org'],
      notBefore: Date.UTC(1999, 0, 1, 0, 0, 0),
      notAfter: Date.UTC(2051, 5, 30, 23, 59, 59),
      serial: '033A94C9DEEE305BC2105F1A7223A87E3B5B023F',
    });
  });

  it('decodes PrintableString, TeletexString and BMPString values', () => {
    expect(parseCert(STRINGS)?.subject).toBe('C=DE, O=Müller GmbH, OU=日本チーム, CN=strings.example.org');
  });

  it('parses the first certificate of a chain', () => {
    expect(parseCert(RSA_LEAF + RSA_CA)).toEqual(parseCert(RSA_LEAF));
    expect(parseCert(RSA_CA)).toMatchObject({
      subject: 'C=TW, O=apiseven test CA, CN=apiseven Test Root',
      issuer: 'C=TW, O=apiseven test CA, CN=apiseven Test Root',
      sans: [],
      notAfter: Date.UTC(2036, 10, 11, 13, 47, 19),
    });
  });

  it('reads the certificate the seed script installs', () => {
    expect(SEED).toContain('BEGIN CERTIFICATE');
    expect(parseCert(SEED)).toEqual({
      subject: 'CN=apiseven.test',
      issuer: 'CN=apiseven.test',
      sans: ['apiseven.test', '*.apiseven.test'],
      dns: ['apiseven.test', '*.apiseven.test'],
      ips: [],
      notBefore: Date.UTC(2026, 10, 14, 11, 25, 54),
      notAfter: Date.UTC(2036, 10, 11, 11, 25, 54),
      serial: '493512B66094780277105F6C6F37DA5ED26CC0DE',
      publicKey: 'ec:P-256:F3F77D268572016E40B9C9900F2B78D276B89F5E9F010704AF0D92E0DDB5E754:0',
    });
  });

  it('accepts CRLF line endings and text around the block', () => {
    const wrapped = `subject=CN=apiseven.test\r\n${SEED.replace(/\n/g, '\r\n')}trailing text`;
    expect(parseCert(wrapped)).toEqual(parseCert(SEED));
  });

  it('returns the same object for the same PEM', () => {
    expect(parseCert(RSA_LEAF)).toBe(parseCert(RSA_LEAF));
  });

  it('gives undefined for input that is not a certificate', () => {
    expect(parseCert('')).toBeUndefined();
    expect(parseCert('not a certificate')).toBeUndefined();
    expect(PRIVATE_KEY).toContain('BEGIN PRIVATE KEY');
    expect(parseCert(PRIVATE_KEY)).toBeUndefined();
    expect(parseCert('-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----')).toBeUndefined();
    expect(parseCert(pemOf(new Uint8Array([0x30, 0x00])))).toBeUndefined();
  });

  it('gives undefined for corrupt base64', () => {
    const lines = SEED.split('\n');
    lines[3] = `${lines[3]?.slice(0, 20) ?? ''}*&%$${lines[3]?.slice(24) ?? ''}`;
    expect(parseCert(lines.join('\n'))).toBeUndefined();
    expect(parseCert(SEED.replace(/[A-Za-z]=*\n-----END/, '\n-----END'))).toBeUndefined();
  });

  it('gives undefined for a certificate cut short anywhere', () => {
    for (const pem of [SEED, RSA_LEAF]) {
      const der = derOf(pem);
      for (let cut = 0; cut < der.length; cut++) {
        expect(parseCert(pemOf(der.subarray(0, cut))), `cut at ${cut}`).toBeUndefined();
      }
    }
  });

  it('gives undefined for indefinite lengths', () => {
    const der = derOf(SEED);
    // 30 82 01 b0 …: replace the two-byte length with the indefinite form 80 and add the end-of-contents octets.
    const indefinite = new Uint8Array([0x30, 0x80, ...der.subarray(4), 0x00, 0x00]);
    expect(parseCert(pemOf(indefinite))).toBeUndefined();
  });

  it('never throws, whichever single byte is corrupted', () => {
    const der = derOf(SEED);
    for (let i = 0; i < der.length; i++) {
      for (const value of [0x00, 0x80, 0xff]) {
        const bad = der.slice();
        bad[i] = value;
        expect(() => parseCert(pemOf(bad)), `byte ${i} = ${value}`).not.toThrow();
      }
    }
  });
});

describe('fingerprintSha256', () => {
  it("gives openssl's SHA-256 fingerprint of the first certificate", async () => {
    expect(await fingerprintSha256(SEED)).toBe(
      'A4:EE:54:BC:BF:E6:8A:D5:92:63:D3:2F:F7:8B:A1:F1:D5:58:DD:B4:10:79:E5:44:A9:AC:DA:01:5E:9F:C8:87',
    );
    const leaf = 'A6:BC:C1:C6:39:3D:76:D0:DD:FB:7F:E3:F8:92:D6:D5:8B:E9:65:C4:46:A5:75:F0:F1:8B:8D:B8:85:3B:3C:EE';
    expect(await fingerprintSha256(RSA_LEAF)).toBe(leaf);
    expect(await fingerprintSha256(RSA_LEAF + RSA_CA)).toBe(leaf);
  });

  it('gives undefined without a certificate block', async () => {
    expect(await fingerprintSha256('')).toBeUndefined();
    expect(await fingerprintSha256(PRIVATE_KEY)).toBeUndefined();
    expect(await fingerprintSha256('-----BEGIN CERTIFICATE-----\n*&%$\n-----END CERTIFICATE-----')).toBeUndefined();
  });
});

// Final wave M3: a certificate text that also holds a private key (a combined PEM) never becomes a key
// of the readers' module caches, which outlive the field and the draft: they are keyed by the
// certificate block alone.
describe('the caches of parseCert and fingerprintOf', () => {
  /** Every key a Map was given while `run` ran. */
  async function keysSetDuring(run: () => unknown): Promise<unknown[]> {
    const set = vi.spyOn(Map.prototype as Map<unknown, unknown>, 'set');
    try {
      await run();
      return set.mock.calls.map(([key]): unknown => key);
    } finally {
      set.mockRestore();
    }
  }
  const keyLine = PRIVATE_KEY.split('\n')[1] ?? '';

  it('never take a combined PEM, or any text around the certificate block, as a key; the same block gives the same result', async () => {
    expect(keyLine.length).toBeGreaterThan(40);
    const combined = `${RSA_LEAF}${PRIVATE_KEY}`;
    const keyFirst = `${PRIVATE_KEY}${EC_IPV6}`;
    const keys = await keysSetDuring(async () => {
      parseCert(combined);
      parseCert(keyFirst);
      await fingerprintOf(combined);
      await fingerprintOf(keyFirst);
      knownFingerprint(combined);
    });
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      expect(key).not.toContain('PRIVATE KEY');
      expect(key).not.toContain(keyLine);
    }
    expect(parseCert(combined)).toBe(parseCert(RSA_LEAF));
    expect(parseCert(keyFirst)).toBe(parseCert(EC_IPV6));
    expect(knownFingerprint(combined)).toEqual({ value: await fingerprintSha256(RSA_LEAF) });
    expect(knownFingerprint(RSA_LEAF)).toEqual(knownFingerprint(combined));
  });

  it('text with no certificate block is read as nothing, and cached under nothing', async () => {
    const keys = await keysSetDuring(async () => {
      expect(parseCert(PRIVATE_KEY)).toBeUndefined();
      expect(await fingerprintOf(PRIVATE_KEY)).toBeUndefined();
      expect(knownFingerprint(PRIVATE_KEY)).toEqual({ value: undefined });
    });
    expect(keys.filter((key) => typeof key === 'string' && key.includes(keyLine))).toEqual([]);
  });
});
