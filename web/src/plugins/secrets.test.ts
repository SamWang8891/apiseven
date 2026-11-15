import { describe, expect, it, vi } from 'vitest';
import { MASK } from '../schema/secrets';
import { pluginFixture } from '../test/pluginFixture';
import { copiedWithout, copiedWithoutKey, MASK_CHANGED, newKeyNotes, redactObject, redactPair, unveilKeys, veilKeys, type KeyNotes } from './secrets';
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

  it("a secret manager's credentials (its manager's SECRET_FIELDS, also those not named like secrets); every value of an entry whose manager isn't known", () => {
    expect(redactObject({ id: 'vault/v1', uri: 'https://vault', prefix: 'kv', token: 'hvs.x' }, 'secrets', all()).value).toEqual({ id: 'vault/v1', uri: 'https://vault', prefix: 'kv', token: MASK });
    expect(redactObject({ id: 'aws/a1', secret_access_key: 'k', access_key_id: 'AKIA', session_token: 's', region: 'eu-west-1' }, 'secrets', all()).value).toEqual({
      id: 'aws/a1',
      secret_access_key: MASK,
      access_key_id: MASK,
      session_token: MASK,
      region: 'eu-west-1',
    });
    const gcp = redactObject({ id: 'gcp/g1', auth_config: { client_email: 'a@b.c', private_key: 'PK', project_id: 'p' } }, 'secrets', undefined);
    expect(gcp.value).toEqual({ id: 'gcp/g1', auth_config: { client_email: 'a@b.c', private_key: MASK, project_id: 'p' } });
    expect(gcp).toMatchObject({ redacted: true, revealable: true });
    // Fails closed: a manager APISIX doesn't have, or no id at all.
    expect(redactObject({ id: 'nope/n1', uri: 'u', anything: 'x' }, 'secrets', all()).value).toEqual({ id: 'nope/n1', uri: MASK, anything: MASK });
    expect(redactObject({ secret_access_key: 'k', access_key_id: 'AKIA' }, 'secrets', all()).value).toEqual({ secret_access_key: MASK, access_key_id: MASK });
  });

  it("plugin metadata: its schema's encrypt_fields once the list has the plugin; every value while it doesn't (not loaded, unknown, no metadata schema)", () => {
    const meta = { id: 'azure-functions', master_apikey: 'key-1', master_clientid: 'cid' };
    expect(redactObject(meta, 'plugin_metadata', all()).value).toEqual({ ...meta, master_apikey: MASK });
    expect(redactObject(meta, 'plugin_metadata', undefined).value).toEqual({ id: 'azure-functions', master_apikey: MASK, master_clientid: MASK });
    expect(redactObject({ id: 'custom-plugin', note: 'x' }, 'plugin_metadata', all()).value).toEqual({ id: 'custom-plugin', note: MASK });
    expect(redactObject({ id: 'key-auth', note: 'x' }, 'plugin_metadata', all()).value).toEqual({ id: 'key-auth', note: MASK });
    expect(redactObject({ id: 'http-logger', log_format: { host: '$host' } }, 'plugin_metadata', all()).value).toEqual({ id: 'http-logger', log_format: { host: '$host' } });
  });

  it('plugin metadata (and a secret) without an id in the body: the id the caller knows decides; none at all masks every value', () => {
    const meta = { master_apikey: 'key-1', master_clientid: 'cid' };
    expect(redactObject(meta, 'plugin_metadata', all(), 'azure-functions').value).toEqual({ master_apikey: MASK, master_clientid: 'cid' });
    expect(redactObject(meta, 'plugin_metadata', all()).value).toEqual({ master_apikey: MASK, master_clientid: MASK });
    expect(redactObject({ uri: 'u', token: 't' }, 'secrets', all(), 'vault/v1').value).toEqual({ uri: 'u', token: MASK });
    // The body's own id wins when it has one.
    expect(redactObject({ id: 'azure-functions', ...meta }, 'plugin_metadata', all(), 'http-logger').value).toEqual({ id: 'azure-functions', master_apikey: MASK, master_clientid: 'cid' });
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

  it("an SSL stored with a private key inside cert, an extra cert or client.ca: the key block is never shown, the certificates are", () => {
    const KEY = '-----BEGIN PRIVATE KEY-----\nSECRETKEYTEXT\n-----END PRIVATE KEY-----\n';
    const CERT = '-----BEGIN CERTIFICATE-----\nCERTTEXT\n-----END CERTIFICATE-----\n';
    const ssl = { snis: ['a.test'], cert: CERT + KEY, certs: [KEY + CERT], client: { ca: CERT + KEY } };
    const out = redactObject(ssl, 'ssls', undefined);
    expect(JSON.stringify(out.value)).not.toContain('SECRETKEYTEXT');
    expect(JSON.stringify(out.revealed)).not.toContain('SECRETKEYTEXT');
    expect(out).toMatchObject({ redacted: true, revealable: false });
    expect(out.value.cert).toBe(`${CERT}${MASK}\n`);
    expect((out.value.certs as string[])[0]).toBe(`${MASK}\n${CERT}`);
    // Another kind's text is left to its own rules.
    expect(redactObject({ desc: CERT + KEY }, 'routes', all()).value).toEqual({ desc: CERT + KEY });
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

describe('veilKeys / unveilKeys: the editing JSON tab never shows an SSL key, and a note is a token, not a place', () => {
  const draft = { snis: ['a.test'], cert: 'CERT', key: 'NEW-KEY', certs: ['C1', 'C2'], keys: ['K1', 'K2'] };
  const note = (notes: KeyNotes, n: number) => t('json.keyNote', { id: `${notes.session}.${n}` });

  it('shows each key as a note of this session; other kinds and SSLs without keys are left as they are', () => {
    const notes = newKeyNotes();
    const veiled = veilKeys('ssls', draft, notes);
    expect(veiled.value).toEqual({ ...draft, key: note(notes, 1), keys: [note(notes, 2), note(notes, 3)] });
    expect(JSON.stringify(veiled.value)).not.toMatch(/NEW-KEY|K1|K2/);
    // The same keys again get the same notes (a Format, a change from outside).
    expect(veilKeys('ssls', draft, veiled.notes).value).toEqual(veiled.value);
    expect(veilKeys('routes', { key: 'x' }, notes)).toMatchObject({ value: { key: 'x' }, veiled: false });
    const plain = { snis: ['a.test'], cert: 'CERT', keys: [null] };
    expect(veilKeys('ssls', plain, notes)).toMatchObject({ value: plain, veiled: false });
  });

  it('a note resolves to the key it was made for wherever it moves, also on a second edit after the move', () => {
    const { value: shown, notes } = veilKeys('ssls', draft, newKeyNotes());
    expect(unveilKeys('ssls', shown, notes)).toEqual({ ok: true, value: draft });
    const keys = shown.keys as string[];
    const swapped = { ...shown, certs: ['C2', 'C1'], keys: [keys[1], keys[0]] };
    expect(unveilKeys('ssls', swapped, notes)).toEqual({ ok: true, value: { ...draft, certs: ['C2', 'C1'], keys: ['K2', 'K1'] } });
    expect(unveilKeys('ssls', { ...swapped, desc: 'd' }, notes)).toEqual({ ok: true, value: { ...draft, certs: ['C2', 'C1'], keys: ['K2', 'K1'], desc: 'd' } });
    const removed = { ...shown, certs: ['C2'], keys: [keys[1]] };
    expect(unveilKeys('ssls', removed, notes)).toEqual({ ok: true, value: { ...draft, certs: ['C2'], keys: ['K2'] } });
    const withoutKey: Record<string, unknown> = { ...shown };
    delete withoutKey.key;
    const back = unveilKeys('ssls', withoutKey, notes);
    expect(back.ok && back.value).not.toHaveProperty('key');
    expect(unveilKeys('ssls', { ...shown, key: '-----BEGIN PRIVATE KEY-----typed' }, notes)).toMatchObject({ ok: true, value: { key: '-----BEGIN PRIVATE KEY-----typed' } });
  });

  it('a note that stands for no key, a changed one, or one used twice is refused, never sent', () => {
    const { value: shown, notes } = veilKeys('ssls', draft, newKeyNotes());
    const other = veilKeys('ssls', draft, newKeyNotes());
    // From another session (an earlier edit, another tab's copy): even with the same number.
    expect(unveilKeys('ssls', { ...shown, key: other.value.key }, notes)).toEqual({ ok: false, problem: t('json.note.unknown') });
    expect(unveilKeys('ssls', { ...shown, key: `${shown.key as string}x` }, notes)).toEqual({ ok: false, problem: t('json.note.unknown') });
    expect(unveilKeys('ssls', { ...shown, keys: [(shown.keys as string[])[0], (shown.keys as string[])[0]] }, notes)).toEqual({ ok: false, problem: t('json.note.twice') });
    // A client certificate's extra keys too (APISIX doesn't parse them, so nothing else would stop a note).
    expect(unveilKeys('ssls', { type: 'client', keys: [`${'•'.repeat(80)}`] }, notes)).toEqual({ ok: false, problem: t('json.note.unknown') });
  });

  it('a note from another page load (another browser tab, a reload) never resolves to this page\'s keys', async () => {
    // Two module instances, as two page loads have: each starts its sessions afresh.
    vi.resetModules();
    const one = await import('./secrets');
    vi.resetModules();
    const two = await import('./secrets');
    const sslA = { cert: 'CERT-A', key: 'KEY-OF-SSL-A', certs: ['XA'], keys: ['XKEY-A'] };
    const sslB = { cert: 'CERT-B', key: 'KEY-OF-SSL-B', certs: ['XB'], keys: ['XKEY-B'] };
    const a = one.veilKeys('ssls', sslA, one.newKeyNotes());
    const b = two.veilKeys('ssls', sslB, two.newKeyNotes());
    expect(a.notes.session).not.toBe(b.notes.session);
    // A's text, pasted into B's editor: refused, never B's keys under A's certificates.
    expect(two.unveilKeys('ssls', a.value, b.notes)).toEqual({ ok: false, problem: t('json.note.unknown') });
    // The session part is random, not a count: fresh sessions of one page differ in more than a counter would.
    const ids = Array.from({ length: 5 }, () => one.newKeyNotes().session);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => /^[0-9a-z]{8,}$/.test(id))).toBe(true);
  });

  it('a key block stored inside a certificate text is a note there too, and comes back in its place', () => {
    const BLOCK = '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----';
    const stored = { cert: `CERTTEXT\n${BLOCK}\n`, client: { ca: `CA\n${BLOCK}` } };
    const { value: shown, notes } = veilKeys('ssls', stored, newKeyNotes());
    expect(JSON.stringify(shown)).not.toContain('SECRET');
    expect(unveilKeys('ssls', shown, notes)).toEqual({ ok: true, value: stored });
    expect(unveilKeys('ssls', { ...shown, cert: (shown.cert as string).replace('private', 'privat') }, notes)).toEqual({ ok: false, problem: t('json.note.unknown') });
  });

  it('a copy leaves the key out when the text copied shows notes and holds no key itself', () => {
    const { value } = veilKeys('ssls', draft, newKeyNotes());
    expect(copiedWithoutKey(JSON.stringify(value))).toBe(true);
    expect(copiedWithoutKey(JSON.stringify({ ...value, keys: ['-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----'] }))).toBe(false);
    expect(copiedWithoutKey(JSON.stringify(draft))).toBe(false);
  });
});
