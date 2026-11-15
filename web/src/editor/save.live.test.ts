// @vitest-environment node
// saveResource against a real APISIX (dev/compose.yaml); skipped otherwise:
//   APISIX_LIVE=1 npx vitest run src/editor/save.live.test.ts
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// It creates one route named after `tag` and removes it; it changes the seeded certificate's SNIs
// and puts them back.
import { afterAll, describe, expect, it } from 'vitest';
import { AdminClient } from '../api/client';
import { stripTimestamps } from '../api/sanitize';
import type { Item } from '../api/types';
import { saveResource, type SaveResult } from './save';

const env = import.meta.env as Record<string, string | undefined>;
const api = new AdminClient({
  id: 'live',
  name: 'live',
  baseUrl: env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180',
  key: env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key',
});
const tag = `apiseven-live-${Date.now().toString(36)}`;
const undo: (() => Promise<unknown>)[] = [];

function saved(result: SaveResult): Item {
  if (!result.ok) throw new Error(`expected a save, got ${'conflict' in result ? 'a conflict' : 'exists' in result ? 'an existing object' : 'unchecked' in result ? result.unchecked.message : result.error.message}`);
  return result.item;
}

describe.skipIf(env.APISIX_LIVE !== '1')('saveResource against a live APISIX', () => {
  afterAll(async () => {
    for (const step of undo.reverse()) await step().catch(() => undefined);
  });

  it('route: create, edit, conflict after an out-of-band change, force, remove', async () => {
    const upstream = { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }] };
    const created = saved(await saveResource(api, { kind: 'routes', isNew: true, draft: { name: tag, uri: `/${tag}`, upstream, x_note: undefined } }));
    undo.push(() => api.remove('routes', created.id));
    expect(created.value).toMatchObject({ name: tag, uri: `/${tag}` });
    expect(created.modifiedIndex).toEqual(expect.any(Number));

    // Edit: the draft is the stored value without timestamps; the result is the re-read object.
    const edited = saved(
      await saveResource(api, { kind: 'routes', id: created.id, isNew: false, draft: { ...stripTimestamps(created.value), uri: `/${tag}/v2` }, original: created }),
    );
    expect(edited.value.uri).toBe(`/${tag}/v2`);
    expect(edited.modifiedIndex).toBeGreaterThan(created.modifiedIndex ?? Infinity);

    // Someone else changes it: a save from the older load reports the conflict and writes nothing.
    await api.patch('routes', created.id, { desc: 'changed elsewhere' });
    const mine = { ...stripTimestamps(edited.value), uri: `/${tag}/mine` };
    const conflict = await saveResource(api, { kind: 'routes', id: created.id, isNew: false, draft: mine, original: edited });
    expect(conflict).toMatchObject({ ok: false, conflict: { value: { desc: 'changed elsewhere', uri: `/${tag}/v2` } } });
    expect((await api.get('routes', created.id)).value.uri).toBe(`/${tag}/v2`);

    // Overwrite with mine: a full PUT, so their desc is gone.
    const forced = saved(await saveResource(api, { kind: 'routes', id: created.id, isNew: false, draft: mine, original: edited, force: true }));
    expect(forced.value.uri).toBe(`/${tag}/mine`);
    expect(forced.value.desc).toBeUndefined();

    await api.remove('routes', created.id);
    await expect(api.get('routes', created.id)).rejects.toMatchObject({ status: 404 });
  });

  it('SSL: a metadata edit PATCHes the seeded certificate and leaves its key usable', async () => {
    const original = await api.get('ssls', 'apiseven-test');
    const before = stripTimestamps(original.value);
    expect(before.key).toBeUndefined();
    const snis = before.snis as string[];
    undo.push(() => api.patch('ssls', 'apiseven-test', { snis }));

    const extra = `${tag}.apiseven.test`;
    const changed = saved(
      await saveResource(api, { kind: 'ssls', id: 'apiseven-test', isNew: false, draft: { ...before, snis: [...snis, extra] }, original }),
    );
    expect(changed.value.snis).toEqual([...snis, extra]);
    expect(changed.value.key).toBeUndefined();
    expect(stripTimestamps(changed.value)).toEqual({ ...before, snis: [...snis, extra] });

    // APISIX re-checks the stored pair on every PATCH (it decrypts and parses the key), so an empty
    // one succeeding shows the key survived, encrypted once.
    await expect(api.patch('ssls', 'apiseven-test', {})).resolves.toMatchObject({ id: 'apiseven-test' });

    // That PATCH was a write, so a save from `changed` is now a conflict; reload, then put it back.
    const stale = await saveResource(api, { kind: 'ssls', id: 'apiseven-test', isNew: false, draft: before, original: changed });
    expect(stale).toMatchObject({ ok: false, conflict: { id: 'apiseven-test' } });
    const latest = await api.get('ssls', 'apiseven-test');
    const restored = saved(await saveResource(api, { kind: 'ssls', id: 'apiseven-test', isNew: false, draft: before, original: latest }));
    expect(stripTimestamps(restored.value)).toEqual(before);
    await expect(api.patch('ssls', 'apiseven-test', {})).resolves.toMatchObject({ id: 'apiseven-test' });
  });
});
