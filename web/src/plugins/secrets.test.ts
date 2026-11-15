import { describe, expect, it } from 'vitest';
import { MASK } from '../schema/secrets';
import { pluginFixture } from '../test/pluginFixture';
import { copiedWithout, MASK_CHANGED, redactObject, redactPair, unveilKeys, veilKeys } from './secrets';
import { t } from '../i18n';

const all = () => pluginFixture().http;

describe('redactObject: what a locked view of a whole object shows', () => {
  it("masks each plugin's encrypt_fields as its scope's schema lists them (a consumer's key-auth key)", () => {
    const consumer = { username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: 'jo-key' }, 'limit-count': { count: 2, time_window: 60 } } };
    const out = redactObject(consumer, 'consumers', all());
    expect(out.redacted).toBe(true);
    expect(out.value).toEqual({ username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: MASK }, 'limit-count': { count: 2, time_window: 60 } } });
    expect(JSON.stringify(out.value)).not.toContain('jo-key');
  });

  it.each([
    ['basic-auth', { username: 'u1', password: 'pw' }, { username: 'u1', password: MASK }],
    ['jwt-auth', { key: 'jwt-id', secret: 's3' }, { key: 'jwt-id', secret: MASK }],
    ['hmac-auth', { key_id: 'kid', secret_key: 'sk' }, { key_id: 'kid', secret_key: MASK }],
  ])("a credential's %s: its secret is masked, its identifier is not", (name, conf, shown) => {
    expect(redactObject({ id: 'c1', plugins: { [name]: conf } }, 'credentials', all()).value).toEqual({ id: 'c1', plugins: { [name]: shown } });
  });

  it('masks secret-named keys anywhere, also outside plugins', () => {
    const value = { plugins: { cors: { allow_origins: '*' } }, upstream: { nodes: [], keepalive_pool: { size: 1 } }, password: 'p', labels: { a: 'b' } };
    expect(redactObject(value, 'routes', all()).value).toEqual({ ...value, password: MASK });
  });

  it('a plugin the loaded list does not know (removed, or custom and not loaded): every value masked, still revealable', () => {
    const value = { plugins: { 'my-logger': { endpoint: 'https://log.example', auth_header: 'Bearer x', port: 1234, on: true } }, labels: { a: 'b' } };
    const out = redactObject(value, 'routes', all());
    expect(out.value).toEqual({ plugins: { 'my-logger': { endpoint: MASK, auth_header: MASK, port: MASK, on: MASK } }, labels: { a: 'b' } });
    expect(out.revealed).toEqual(value);
    expect(out.revealable).toBe(true);
  });

  it('until the plugin list has loaded, every value inside plugins is masked (which are secret is not known yet)', () => {
    const out = redactObject({ username: 'jo', plugins: { 'key-auth': { key: 'jo-key' }, cors: { allow_origins: '*', max_age: 5 } } }, 'consumers', undefined);
    expect(out.value).toEqual({ username: 'jo', plugins: { 'key-auth': { key: MASK }, cors: { allow_origins: MASK, max_age: MASK } } });
    expect(out.redacted).toBe(true);
  });

  it('leaves an object without secrets as it is, and says nothing was masked', () => {
    const value = { id: 'g', plugins: { 'limit-count': { count: 1, time_window: 1 } } };
    const out = redactObject(value, 'consumer_groups', all());
    expect(out).toEqual({ value, revealed: value, redacted: false, revealable: false });
    expect(out.value).toBe(value);
  });
});

describe('redactObject, per kind', () => {
  const logger = { 'http-logger': { uri: 'http://log.test', auth_header: 'Bearer s3' } };
  const masked = { 'http-logger': { uri: 'http://log.test', auth_header: MASK } };

  it.each(['routes', 'services', 'global_rules', 'plugin_configs', 'consumer_groups', 'consumers'] as const)(
    "%s: a plugin's encrypt_fields (http-logger auth_header) are masked, and shown on reveal",
    (kind) => {
      const out = redactObject({ plugins: logger }, kind, all());
      expect(out.value).toEqual({ plugins: masked });
      expect(out.revealed).toEqual({ plugins: logger });
      expect(out.revealable).toBe(true);
    },
  );

  it("a stream route's plugins against the stream set", () => {
    const stream = pluginFixture().stream;
    expect(redactObject({ plugins: { 'limit-conn': { conn: 1, burst: 0, default_conn_delay: 1, key: 'remote_addr' } } }, 'stream_routes', stream).redacted).toBe(false);
  });

  it("an upstream's tls.client_key (APISIX's ciphertext) is never shown, not even on reveal; nothing else to reveal, so no toggle", () => {
    const up = { nodes: [{ host: 'a', port: 443, weight: 1 }], tls: { client_cert: 'CERT', client_key: 'AES-ciphertext' } };
    const out = redactObject(up, 'upstreams', all());
    expect(out.value).toEqual({ ...up, tls: { client_cert: 'CERT', client_key: MASK } });
    expect(out.revealed).toEqual(out.value);
    expect(out).toMatchObject({ redacted: true, revealable: false });
  });

  it("a route's inline upstream client_key too; its plugin secret is revealable", () => {
    const route = { uri: '/', upstream: { tls: { client_cert: 'C', client_key: 'AES-x' } }, plugins: logger };
    const out = redactObject(route, 'routes', all());
    expect(JSON.stringify(out.value)).not.toContain('AES-x');
    expect(JSON.stringify(out.revealed)).not.toContain('AES-x');
    expect(JSON.stringify(out.revealed)).toContain('Bearer s3');
  });

  it("a secret manager's token, and an SSL's (never returned) key fields by name", () => {
    expect(redactObject({ uri: 'https://vault', prefix: 'kv', token: 'hvs.x' }, 'secrets', all()).value).toEqual({ uri: 'https://vault', prefix: 'kv', token: MASK });
    expect(redactObject({ secret_access_key: 'k', access_key_id: 'AKIA' }, 'secrets', all()).value).toEqual({ secret_access_key: MASK, access_key_id: 'AKIA' });
  });

  it("an SSL's private keys (a new one in the draft) are never shown, not even on reveal; its certificates and CA are not secrets", () => {
    const ssl = { snis: ['a.test'], cert: 'CERT-PEM', key: 'KEY-PEM', certs: ['C1', 'C2'], keys: ['K1', null], client: { ca: 'CA-PEM' } };
    const out = redactObject(ssl, 'ssls', undefined);
    expect(out.value).toEqual({ ...ssl, key: MASK, keys: [MASK, null] });
    expect(out.revealed).toEqual(out.value);
    expect(out).toMatchObject({ redacted: true, revealable: false });
    expect(JSON.stringify(out)).not.toMatch(/KEY-PEM|K1/);
    // A plugin's `key` (key-auth) is another matter: only an SSL's top-level key fields are never shown.
    expect(redactObject({ key: 'k' }, 'routes', all()).value).toEqual({ key: 'k' });
    expect(redactObject({ snis: ['a.test'], cert: 'C' }, 'ssls', undefined)).toMatchObject({ redacted: false });
  });

  it("plugin metadata: its plugin's metadata encrypt_fields (azure-functions master_apikey); everything while loading", () => {
    expect(redactObject({ id: 'azure-functions', master_apikey: 'k1', other: 'x' }, 'plugin_metadata', all()).value).toEqual({ id: 'azure-functions', master_apikey: MASK, other: 'x' });
    expect(redactObject({ id: 'azure-functions', master_apikey: 'k1' }, 'plugin_metadata', undefined).value).toEqual({ id: 'azure-functions', master_apikey: MASK });
  });
});

describe('redactPair: the two sides of a conflict', () => {
  it('a secret that differs reads as changed on their side, without either value; an equal one does not', () => {
    const mine = { id: 'c1', name: 'a', plugins: { 'key-auth': { key: 'mine' } } };
    const theirs = { id: 'c1', name: 'b', plugins: { 'key-auth': { key: 'theirs' } } };
    const pair = redactPair(mine, theirs, 'credentials', all());
    expect(pair.masked).toEqual([
      { id: 'c1', name: 'a', plugins: { 'key-auth': { key: MASK } } },
      { id: 'c1', name: 'b', plugins: { 'key-auth': { key: MASK_CHANGED } } },
    ]);
    expect(JSON.stringify(pair.masked)).not.toMatch(/mine|theirs/);
    expect(pair.revealed).toEqual([mine, theirs]);
    expect(redactPair(mine, { ...mine, name: 'b' }, 'credentials', all()).masked[1]).toEqual({ id: 'c1', name: 'b', plugins: { 'key-auth': { key: MASK } } });
  });

  it('a never-shown key that differs reads as changed in the revealed view too', () => {
    const a = { tls: { client_cert: 'C', client_key: 'AES-1' } };
    const b = { tls: { client_cert: 'C', client_key: 'AES-2' } };
    const pair = redactPair(a, b, 'upstreams', all());
    expect(pair.revealed[1]).toEqual({ tls: { client_cert: 'C', client_key: MASK_CHANGED } });
    expect(pair.revealable).toBe(false);
  });
});

describe('copiedWithout: what a copy of the shown JSON lacks, for its toast', () => {
  const logger = { 'http-logger': { uri: 'http://log.test', auth_header: 'Bearer s3' } };
  it('masked secrets that Show secrets would add; once revealed, only a never-shown key; nothing when nothing is masked', () => {
    const route = redactObject({ uri: '/', plugins: logger, upstream: { tls: { client_cert: 'C', client_key: 'AES-x' } } }, 'routes', all());
    expect(copiedWithout(route, false)).toBe('masked');
    expect(copiedWithout(route, true)).toBe('neverShown');
    const upstream = redactObject({ nodes: [], tls: { client_cert: 'C', client_key: 'AES-x' } }, 'upstreams', all());
    expect(copiedWithout(upstream, false)).toBe('neverShown');
    expect(copiedWithout(redactObject({ plugins: logger }, 'routes', all()), true)).toBeUndefined();
    expect(copiedWithout(redactObject({ uri: '/' }, 'routes', all()), false)).toBeUndefined();
  });
});

describe('veilKeys / unveilKeys: the editing JSON tab never shows an SSL key it holds', () => {
  const draft = { snis: ['a.test'], cert: 'CERT', key: 'NEW-KEY', certs: ['C1', 'C2'], keys: ['K1', 'K2'] };

  it('shows each key as a note in its place; other kinds and SSLs without keys are left as they are', () => {
    const veiled = veilKeys('ssls', draft);
    expect(veiled.veiled).toBe(true);
    expect(veiled.value).toEqual({ ...draft, key: t('json.keyHidden'), keys: [t('json.keysHidden', { n: 1 }), t('json.keysHidden', { n: 2 })] });
    expect(JSON.stringify(veiled.value)).not.toMatch(/NEW-KEY|K1|K2/);
    expect(veilKeys('routes', { key: 'x' })).toEqual({ value: { key: 'x' }, veiled: false });
    const plain = { snis: ['a.test'], cert: 'CERT', keys: [null] };
    expect(veilKeys('ssls', plain)).toEqual({ value: plain, veiled: false });
  });

  it('turns the notes back into the keys they stand for, where they went; a removed note removes its key; typed text stays', () => {
    const shown = veilKeys('ssls', draft).value;
    expect(unveilKeys('ssls', shown, draft)).toEqual(draft);
    expect(unveilKeys('ssls', { ...shown, desc: 'd' }, draft)).toEqual({ ...draft, desc: 'd' });
    const reordered = { ...shown, certs: ['C2', 'C1'], keys: [t('json.keysHidden', { n: 2 }), t('json.keysHidden', { n: 1 })] };
    expect(unveilKeys('ssls', reordered, draft)).toEqual({ ...draft, certs: ['C2', 'C1'], keys: ['K2', 'K1'] });
    const withoutKey: Record<string, unknown> = { ...shown };
    delete withoutKey.key;
    expect(unveilKeys('ssls', withoutKey, draft)).not.toHaveProperty('key');
    expect(unveilKeys('ssls', { ...shown, key: '-----BEGIN PRIVATE KEY-----typed' }, draft).key).toBe('-----BEGIN PRIVATE KEY-----typed');
    // A note with nothing behind it (pasted into another object) stays as typed, for the checks to refuse.
    expect(unveilKeys('ssls', { key: t('json.keyHidden') }, {}).key).toBe(t('json.keyHidden'));
  });
});
