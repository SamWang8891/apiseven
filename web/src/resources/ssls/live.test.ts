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
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { sslIssues } from './validate';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const [tlsHost = '127.0.0.1', tlsPort = '9443'] = (env.APISIX_TLS ?? '127.0.0.1:9443').split(':');
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : 'exists' in result ? 'an existing object' : 'unchecked' in result ? result.unchecked.message : result.error.message}`);
  return result.item;
}

/** The subject CN APISIX presents for `servername` (undefined: no certificate, or the port is closed). */
function presented(servername: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = connect({ host: tlsHost, port: Number(tlsPort), servername, rejectUnauthorized: false }, () => {
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
async function until(servername: string, want: string | undefined): Promise<string | undefined> {
  let cn = await presented(servername);
  for (let i = 0; i < 20 && cn !== want; i++) {
    await new Promise((r) => setTimeout(r, 250));
    cn = await presented(servername);
  }
  return cn;
}

describe.skipIf(env.APISIX_LIVE !== '1')('an SSL, against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('create, PATCH of its SNIs without the key, a full PUT with a new pair, a refusal sslIssues predicts, delete', async () => {
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

    // Replace: the draft has the pair again, so a full PUT; what comes back has no key, so the next save is a PATCH.
    const replaced = saved(await saveResource(api, { kind: 'ssls', id: created.id, isNew: false, draft: { ...stripTimestamps(patched.value), cert: SEED_CERT, key: SEED_KEY }, original: patched }));
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
});
