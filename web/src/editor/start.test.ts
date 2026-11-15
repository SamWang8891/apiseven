import { describe, expect, it } from 'vitest';
import { itemOf } from '../test/ctx';
import { startOf } from './start';

const CERT = '-----BEGIN CERTIFICATE-----\nCERTTEXT\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN PRIVATE KEY-----\nSECRETKEYTEXT\n-----END PRIVATE KEY-----\n';

describe('startOf: a copy of an SSL', () => {
  // As a GET gives it: no key, no keys.
  const SOURCE = itemOf('orig', { snis: ['a.test', '*.a.test'], cert: CERT, certs: [CERT, CERT], labels: { env: 'dev' }, create_time: 1, update_time: 2 });

  it('takes everything but the id; notes the main key and the extra keys left out, and the SNIs still shared', () => {
    const start = startOf('ssls', SOURCE, undefined, null);
    expect(start.draft).toEqual({ snis: ['a.test', '*.a.test'], cert: CERT, certs: [CERT, CERT], labels: { env: 'dev' } });
    expect(start.copy).toEqual({ removed: [], shared: [], ssl: { extraKeys: 2, snis: ['a.test', '*.a.test'], keyInCert: false } });
  });

  it('shares no SNI with an original APISIX does not present (disabled, or a client certificate)', () => {
    expect(startOf('ssls', itemOf('o', { snis: ['a.test'], cert: CERT, status: 0 }), undefined, null).copy?.ssl?.snis).toEqual([]);
    expect(startOf('ssls', itemOf('o', { type: 'client', cert: CERT }), undefined, null).copy?.ssl).toEqual({ extraKeys: 0, snis: [], keyInCert: false });
  });

  it('leaves out a private key stored inside the certificate texts, and says so', () => {
    const start = startOf('ssls', itemOf('o', { sni: 'a.test', cert: CERT + KEY, certs: [KEY + CERT], client: { ca: CERT + KEY } }), undefined, null);
    expect(JSON.stringify(start.draft)).not.toContain('SECRETKEYTEXT');
    expect(start.draft).toEqual({ sni: 'a.test', cert: CERT, certs: [CERT], client: { ca: CERT } });
    expect(start.copy?.ssl?.keyInCert).toBe(true);
  });

  it('a new SSL that is not a copy has no notes', () => {
    expect(startOf('ssls', undefined, undefined, null).copy).toBeUndefined();
  });
});

describe('startOf: a copy of a secret manager entry', () => {
  it('keeps the manager (the ID field starts on "vault/") and the credentials, and notes which were copied', () => {
    const start = startOf('secrets', itemOf('vault/v1', { uri: 'http://v', prefix: 'p', token: 'hvs', create_time: 1, update_time: 2 }), undefined, null);
    expect(start.draft).toEqual({ uri: 'http://v', prefix: 'p', token: 'hvs' });
    expect(start.newId).toBe('vault/');
    expect(start.copy).toEqual({ removed: [], shared: [], credentials: { from: 'vault/v1', fields: ['token'] } });
    const aws = startOf('secrets', itemOf('aws/a1', { access_key_id: 'A', secret_access_key: 'S' }), undefined, null);
    expect(aws.copy?.credentials).toEqual({ from: 'aws/a1', fields: ['access_key_id', 'secret_access_key'] });
    const gcp = startOf('secrets', itemOf('gcp/g1', { auth_config: { private_key: 'K' } }), undefined, null);
    expect(gcp.copy?.credentials?.fields).toEqual(['auth_config.private_key']);
  });

  it('an entry of a manager APISIX lacks: no manager to start on, nothing named as copied', () => {
    const start = startOf('secrets', itemOf('nope/x', { a: 1 }), undefined, null);
    expect(start.newId).toBe('');
    expect(start.copy?.credentials).toEqual({ from: 'nope/x', fields: [] });
  });
});
