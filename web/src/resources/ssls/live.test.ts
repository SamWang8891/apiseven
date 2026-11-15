// @vitest-environment node
// An SSL as the editor writes it, saved to a real APISIX (dev/compose.yaml) and, when its HTTPS port
// answers, presented to a TLS client; skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/resources/ssls/live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key),
// APISIX_TLS (default 127.0.0.1:9443). It uses the seed's throwaway pair (dev/seed.mjs) under an SNI
// named after `tag`, and removes the SSL it creates.
import { connect } from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../../api/client';
import { stripTimestamps } from '../../api/sanitize';
import type { Item, Obj } from '../../api/types';
import { saveResource, type SaveResult } from '../../editor/save';
import { ctxOf } from '../../test/ctx';
import { BAG_KEY, EC_PAIR, EC_PARAMS_KEY, RSA_PAIR } from '../../test/pairs';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { takenValue, takes } from './pemBox';
import { sslIssues } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
/** The writes the editor's save made, method and body. */
const writes: { method: string; body: unknown }[] = [];
const api = new AdminClient(
  {
    id: 'live',
    name: 'live',
    baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
    key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
  },
  (input, init) => {
    if (init?.method && init.method !== 'GET') writes.push({ method: init.method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return fetch(input, init);
  },
);
const [tlsHost = '127.0.0.1', tlsPort = '9443'] = (env.APISIX_TLS ?? '127.0.0.1:9443').split(':');
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : 'exists' in result ? 'an existing object' : 'unchecked' in result ? result.unchecked.message : result.error.message}`);
  return result.item;
}

/**
 * The subject CN APISIX presents for `servername` (undefined: no certificate, or the port is closed).
 * `sigalgs` limits what the client accepts, so a server with an RSA and an EC pair picks that one.
 */
function presented(servername: string, sigalgs?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = connect({ host: tlsHost, port: Number(tlsPort), servername, rejectUnauthorized: false, ...(sigalgs ? { sigalgs, minVersion: 'TLSv1.3' as const } : {}) }, () => {
      const cn = socket.getPeerCertificate().subject?.CN;
      socket.end();
      resolve(typeof cn === 'string' ? cn : undefined);
    });
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.on('error', () => resolve(undefined));
  });
}

/** The CN once APISIX has picked the change up from etcd (a moment after the write). */
async function until(servername: string, want: string | undefined, sigalgs?: string): Promise<string | undefined> {
  let cn = await presented(servername, sigalgs);
  for (let i = 0; i < 20 && cn !== want; i++) {
    await new Promise((r) => setTimeout(r, 250));
    cn = await presented(servername, sigalgs);
  }
  return cn;
}

const ECDSA = 'ecdsa_secp256r1_sha256';
const RSA = 'rsa_pss_rsae_sha256:rsa_pkcs1_sha256';

describe.skipIf(env.APISIX_LIVE !== '1')('an SSL, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('create, PATCH of its SNIs without the key, a PATCH of a new pair, a refusal sslIssues predicts, delete', async () => {
    // The HTTPS port answers when the seed's certificate is presented for its own name.
    const tlsOpen = (await presented('apiseven.test')) === 'apiseven.test';
    // Not under *.apiseven.test, which the seed's SSL serves: only this one presents a certificate for it.
    const sni = `${tag}.live.test`;
    const draft: Obj = { status: 1, sni, cert: SEED_CERT, key: SEED_KEY };
    expect(sslIssues(draft, { isNew: true, ctx: ctxOf() })).toEqual([]);
    const created = saved(await saveResource(api, { kind: 'ssls', isNew: true, draft }));
    undo.push(() => api.remove('ssls', created.id));
    // APISIX never returns the key, so the draft the editor gets back has none.
    expect(created.value).not.toHaveProperty('key');
    expect(created.value).toMatchObject({ sni, cert: SEED_CERT });

    // SNIs only: a PATCH (no key in the draft), and the stored key keeps working.
    const other = `${tag}-b.live.test`;
    const renamed: Obj = { ...stripTimestamps(created.value), snis: [sni, other] };
    delete renamed.sni;
    expect(sslIssues(renamed, { isNew: false, ctx: ctxOf(), original: created })).toEqual([]);
    const patched = saved(await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: renamed, original: created }));
    expect(patched.value).toMatchObject({ snis: [sni, other] });
    expect(patched.value).not.toHaveProperty('key');
    if (tlsOpen) {
      expect(await until(other, 'apiseven.test')).toBe('apiseven.test');
      expect(await presented(`x.${tag}.live.test`)).toBeUndefined();
    }

    // Replace: the draft has the pair again, saved as PATCH {cert, key}; what comes back has no key, so the next save is a PATCH without one.
    writes.length = 0;
    const replaced = saved(await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: { ...stripTimestamps(patched.value), cert: SEED_CERT, key: SEED_KEY }, original: patched }));
    // The cert is unchanged here, so only the key goes.
    expect(writes).toEqual([{ method: 'PATCH', body: { key: SEED_KEY } }]);
    expect(replaced.value).not.toHaveProperty('key');
    expect(replaced.value).toMatchObject({ snis: [sni, other], cert: SEED_CERT });

    // An extra cert without its key: sslIssues refuses it, and so does APISIX (ssl.lua 205–208).
    const unpaired: Obj = { ...stripTimestamps(replaced.value), certs: [SEED_CERT] };
    expect(sslIssues(unpaired, { isNew: false, ctx: ctxOf(), original: replaced }).map((i) => i.path)).toEqual(['keys']);
    const refused = await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: unpaired, original: replaced });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && 'error' in refused && refused.error.errorMsg).toBe('mismatched number of certs and keys');

    await api.remove('ssls', created.id);
    undo.pop();
    if (tlsOpen) expect(await until(other, undefined)).toBeUndefined();
  });

  it('a new main pair on an SSL with an extra pair is PATCH {cert, key}: the stored extra key stays and still serves', async () => {
    const tlsOpen = (await presented('apiseven.test')) === 'apiseven.test';
    const sni = `${tag}-pair.live.test`;
    const draft: Obj = { status: 1, sni, cert: SEED_CERT, key: SEED_KEY, certs: [RSA_PAIR.cert], keys: [RSA_PAIR.key] };
    expect(sslIssues(draft, { isNew: true, ctx: ctxOf() })).toEqual([]);
    const created = saved(await saveResource(api, { kind: 'ssls', isNew: true, draft }));
    undo.push(() => api.remove('ssls', created.id));
    expect(created.value).toMatchObject({ certs: [RSA_PAIR.cert] });
    expect(created.value).not.toHaveProperty('keys');
    if (tlsOpen) {
      expect(await until(sni, 'apiseven.test', ECDSA)).toBe('apiseven.test');
      expect(await presented(sni, RSA)).toBe('rsa-extra.apiseven.test');
    }

    // The main pair replaced: no extra key typed again, and the save is a PATCH of the pair alone.
    const rotated: Obj = { ...stripTimestamps(created.value), cert: EC_PAIR.cert, key: EC_PAIR.key };
    expect(sslIssues(rotated, { isNew: false, ctx: ctxOf(), original: created })).toEqual([]);
    writes.length = 0;
    const replaced = saved(await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: rotated, original: created }));
    expect(writes).toEqual([{ method: 'PATCH', body: { cert: EC_PAIR.cert, key: EC_PAIR.key } }]);
    expect(replaced.value).toMatchObject({ cert: EC_PAIR.cert, certs: [RSA_PAIR.cert] });
    expect(replaced.value).not.toHaveProperty('key');

    // The count still holds: a later PATCH is accepted (APISIX checks certs against the stored keys).
    const described = saved(await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: { ...stripTimestamps(replaced.value), desc: tag }, original: replaced }));
    expect(described.value).toMatchObject({ desc: tag, certs: [RSA_PAIR.cert] });

    if (tlsOpen) {
      // The new main certificate is presented, and the extra pair's stored key still serves its certificate.
      expect(await until(sni, 'rotated.apiseven.test', ECDSA)).toBe('rotated.apiseven.test');
      expect(await presented(sni, RSA)).toBe('rsa-extra.apiseven.test');
    }
  });

  it('the key box takes what APISIX stores and serves: an EC PARAMETERS block first, a line after the key, and (Task 16 B23) a key with Bag Attributes or a blank line first, taken from its BEGIN line', async () => {
    const tlsOpen = (await presented('apiseven.test')) === 'apiseven.test';
    // Taken by the key box, stored by APISIX, and presented for its SNI: OpenSSL skips what is not the key.
    for (const [name, key] of [
      ['ecparams', EC_PARAMS_KEY],
      ['after', `${EC_PAIR.key}# rotated in November\n`],
    ] as const) {
      expect(takes('key', key), name).toBe(true);
      expect(takenValue('key', key), name).toBe(key);
      const sni = `${tag}-${name}.live.test`;
      const draft: Obj = { status: 1, sni, cert: EC_PAIR.cert, key };
      expect(sslIssues(draft, { isNew: true, ctx: ctxOf() })).toEqual([]);
      const created = saved(await saveResource(api, { kind: 'ssls', isNew: true, draft }));
      undo.push(() => api.remove('ssls', created.id));
      if (tlsOpen) expect(await until(sni, 'rotated.apiseven.test', ECDSA), name).toBe('rotated.apiseven.test');
    }
    // Text before the first BEGIN line: as given, APISIX takes the key for an encrypted one (its text does
    // not start with "---", aes_decrypt_pkey, ssl.lua 98–104) and refuses it; the box takes it from its
    // BEGIN line instead, which APISIX stores and presents.
    for (const [name, text] of [
      ['bag', BAG_KEY],
      ['blank', `\n${RSA_PAIR.key}`],
    ] as const) {
      const sni = `${tag}-${name}.live.test`;
      const refused = await saveResource(api, { kind: 'ssls', isNew: true, draft: { status: 1, sni, cert: RSA_PAIR.cert, key: text } });
      if (refused.ok) undo.push(() => api.remove('ssls', refused.item.id));
      expect(!refused.ok && 'error' in refused && refused.error.errorMsg, name).toBe('failed to decrypt previous encrypted key');
      expect(takes('key', text), name).toBe(true);
      const key = takenValue('key', text);
      expect(key, name).toBe(RSA_PAIR.key);
      const created = saved(await saveResource(api, { kind: 'ssls', isNew: true, draft: { status: 1, sni, cert: RSA_PAIR.cert, key } }));
      undo.push(() => api.remove('ssls', created.id));
      if (tlsOpen) expect(await until(sni, 'rsa-extra.apiseven.test', RSA), name).toBe('rsa-extra.apiseven.test');
    }
  });
});
