import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { RSA_LEAF } from '../../test/certs';
import { ctxOf, itemOf } from '../../test/ctx';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { sslIssues } from './validate';

const KEY = SEED_KEY;
const CERT = SEED_CERT;
const STORED = itemOf('s1', { snis: ['a.test'], cert: CERT, certs: [RSA_LEAF] });

const issues = (draft: Obj, opts: { isNew?: boolean; original?: Obj } = {}) =>
  sslIssues(draft, { isNew: opts.isNew ?? false, ctx: ctxOf(), original: opts.original ? itemOf('s1', opts.original) : undefined });
const paths = (draft: Obj, opts: { isNew?: boolean; original?: Obj } = {}) => issues(draft, opts).map((i) => i.path);

describe('sslIssues: what the ssl schema requires per type (schema_def.lua 982–989)', () => {
  it('a new server certificate needs cert, key and one of sni / snis', () => {
    expect(issues({}, { isNew: true })).toEqual([
      { path: 'cert', message: t('ssl.issue.certRequired') },
      { path: 'key', message: t('ssl.issue.keyRequired') },
      { path: 'snis', message: t('ssl.issue.sniRequired') },
    ]);
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'] }, { isNew: true })).toEqual([]);
    expect(issues({ cert: CERT, key: KEY, sni: 'a.test' }, { isNew: true })).toEqual([]);
  });

  it('both sni and snis are refused (oneOf), and an empty snis is no SNI (minItems 1)', () => {
    expect(issues({ cert: CERT, key: KEY, sni: 'a.test', snis: ['b.test'] }, { isNew: true })).toEqual([{ path: 'snis', message: t('ssl.issue.both') }]);
    expect(paths({ cert: CERT, key: KEY, snis: [] }, { isNew: true })).toEqual(['snis']);
  });

  it('a client certificate needs cert and key only', () => {
    expect(issues({ type: 'client', cert: CERT, key: KEY }, { isNew: true })).toEqual([]);
    expect(paths({ type: 'client' }, { isNew: true })).toEqual(['cert', 'key']);
  });

  it('a stored object needs no key in the draft: the save is a PATCH that keeps the stored one', () => {
    expect(issues({ cert: CERT, snis: ['a.test'] })).toEqual([]);
    expect(paths({ snis: ['a.test'] })).toEqual(['cert']);
  });
});

describe('sslIssues: field formats', () => {
  it('cert and key lengths (certificate_scheme 128–65536, private_key_schema 64–65536), not for a $secret:// or $env:// reference', () => {
    expect(issues({ cert: 'short', key: 'short', snis: ['a.test'] }, { isNew: true })).toEqual([
      { path: 'cert', message: t('ssl.issue.certLength') },
      { path: 'key', message: t('ssl.issue.keyLength') },
    ]);
    // secret.lua 268–280 and core/schema.lua 43–45: the validator skips a reference.
    expect(issues({ cert: '$secret://vault/1/cert', key: '$ENV://SSL_KEY', snis: ['a.test'] }, { isNew: true })).toEqual([]);
    expect(paths({ cert: 42, key: KEY, snis: ['a.test'] }, { isNew: true })).toEqual(['cert']);
  });

  it('SNIs follow host_def_pat; a wildcard and "*" pass, a space does not', () => {
    expect(issues({ cert: CERT, snis: ['*.a.test', '*', 'b.test'] })).toEqual([]);
    expect(issues({ cert: CERT, snis: ['ok.test', 'bad host'] })).toEqual([{ path: 'snis.1', message: t('rt.issue.host', { host: 'bad host' }) }]);
    expect(issues({ cert: CERT, sni: 'bad host' })).toEqual([{ path: 'sni', message: t('rt.issue.host', { host: 'bad host' }) }]);
    // Repeats are stored (the ssl schema has no uniqueItems for snis; checked live).
    expect(issues({ cert: CERT, snis: ['a.test', 'a.test'] })).toEqual([]);
  });

  it('type, status, desc and labels', () => {
    expect(issues({ cert: CERT, snis: ['a.test'], type: 'mtls', status: 2, desc: 'x'.repeat(257), labels: { a: 'b c' } })).toEqual([
      { path: 'type', message: t('ssl.issue.type') },
      { path: 'status', message: t('ssl.issue.status') },
      { path: 'desc', message: t('ssl.issue.desc') },
      { path: 'labels', message: t('rt.issue.labels') },
    ]);
  });

  it('ssl_protocols: up to three of the enum, each once; [] is stored (checked live)', () => {
    expect(issues({ cert: CERT, snis: ['a.test'], ssl_protocols: [] })).toEqual([]);
    expect(issues({ cert: CERT, snis: ['a.test'], ssl_protocols: ['TLSv1.2', 'TLSv1.3'] })).toEqual([]);
    expect(paths({ cert: CERT, snis: ['a.test'], ssl_protocols: ['TLSv1'] })).toEqual(['ssl_protocols']);
    expect(paths({ cert: CERT, snis: ['a.test'], ssl_protocols: ['TLSv1.2', 'TLSv1.2'] })).toEqual(['ssl_protocols']);
  });
});

describe('sslIssues: client mTLS (schema_def.lua 942–965)', () => {
  const base = { cert: CERT, snis: ['a.test'] };
  it('needs a CA; depth is a whole number ≥ 0; the skip list is non-empty and unique', () => {
    expect(issues({ ...base, client: { ca: CERT, depth: 2, skip_mtls_uri_regex: ['^/health'] } })).toEqual([]);
    expect(issues({ ...base, client: {} })).toEqual([{ path: 'client.ca', message: t('ssl.issue.caRequired') }]);
    expect(issues({ ...base, client: { ca: CERT, depth: -1 } })).toEqual([{ path: 'client.depth', message: t('ssl.issue.depth') }]);
    expect(issues({ ...base, client: { ca: CERT, depth: 1.5 } })).toEqual([{ path: 'client.depth', message: t('ssl.issue.depth') }]);
    expect(issues({ ...base, client: { ca: CERT, skip_mtls_uri_regex: [] } })).toEqual([{ path: 'client.skip_mtls_uri_regex', message: t('ssl.issue.skipEmpty') }]);
    expect(issues({ ...base, client: { ca: CERT, skip_mtls_uri_regex: ['a', 'a'] } })).toEqual([{ path: 'client.skip_mtls_uri_regex', message: t('ssl.issue.skipRepeat') }]);
    expect(issues({ ...base, client: { ca: 'short' } })).toEqual([{ path: 'client.ca', message: t('ssl.issue.caLength') }]);
  });

  it('an empty table is an object to APISIX: client [] needs its CA like {}', () => {
    expect(issues({ ...base, client: [] })).toEqual([{ path: 'client.ca', message: t('ssl.issue.caRequired') }]);
    expect(paths({ ...base, client: 'on' })).toEqual(['client']);
  });
});

describe('sslIssues: additional pairs, as APISIX counts them after the save (ssl.lua 205–208)', () => {
  it('a new or replaced object: as many keys as certs', () => {
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'], certs: [RSA_LEAF], keys: [KEY] }, { isNew: true })).toEqual([]);
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'], certs: [RSA_LEAF] }, { isNew: true })).toEqual([
      { path: 'keys', message: t('ssl.issue.needKeys') },
    ]);
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'], certs: [RSA_LEAF], keys: [KEY, KEY] }, { isNew: true })).toEqual([
      { path: 'keys', message: t('ssl.issue.countKeys', { certs: 1, keys: 2 }) },
    ]);
  });

  it('a stored object saved without its main key (PATCH): unchanged pairs keep their stored keys', () => {
    expect(issues({ cert: CERT, snis: ['a.test'], certs: [RSA_LEAF] }, { original: STORED.value })).toEqual([]);
  });

  it('a PATCH that changes how many certs there are without their keys is refused: the stored keys stay', () => {
    expect(issues({ cert: CERT, snis: ['a.test'], certs: [RSA_LEAF, RSA_LEAF] }, { original: STORED.value })).toEqual([
      { path: 'keys', message: t('ssl.issue.reenterKeys') },
    ]);
    // All pairs removed: certs goes as null but the stored keys stay (checked live: 400), unless keys: [] goes too.
    expect(paths({ cert: CERT, snis: ['a.test'] }, { original: STORED.value })).toEqual(['keys']);
    expect(issues({ cert: CERT, snis: ['a.test'], keys: [] }, { original: STORED.value })).toEqual([]);
  });

  it('a replaced main pair on an object with extra pairs keeps their stored keys (PATCH {cert, key}: APISIX merges)', () => {
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'], certs: [RSA_LEAF] }, { original: STORED.value })).toEqual([]);
  });

  it('a key still to enter is an issue at its place (keys are strings: private_key_schema)', () => {
    expect(issues({ cert: CERT, snis: ['a.test'], certs: [RSA_LEAF, RSA_LEAF], keys: [null, KEY] }, { original: STORED.value })).toEqual([
      { path: 'keys.0', message: t('ssl.issue.keyMissing', { n: 1 }) },
    ]);
  });

  it('a client certificate is not counted (check_ssl_conf returns before the count, ssl.lua 201–203)', () => {
    expect(issues({ type: 'client', cert: CERT, key: KEY, certs: [RSA_LEAF] }, { isNew: true })).toEqual([]);
  });

  it('each extra cert and key has the schema length', () => {
    expect(issues({ cert: CERT, key: KEY, snis: ['a.test'], certs: ['short'], keys: ['short'] }, { isNew: true })).toEqual([
      { path: 'certs.0', message: t('ssl.issue.certsItem', { n: 1 }) },
      { path: 'keys.0', message: t('ssl.issue.keysItem', { n: 1 }) },
    ]);
  });
});
