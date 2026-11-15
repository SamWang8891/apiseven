// Writing a draft back to APISIX. Pure (no React): the frame decides what to show for each outcome.
import type { AdminClient } from '../api/client';
import { ApiError } from '../api/errors';
import { isObj, stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { deepEqual } from './draft';

export interface SaveArgs {
  kind: Kind;
  /** The object's id (edit), or the chosen id for a new one (undefined: APISIX generates one). */
  id?: string;
  isNew: boolean;
  draft: Obj;
  /** The stored item the draft was loaded from (edit); its modifiedIndex is the conflict check. */
  original?: Item;
  parent?: Parent;
  /** Write even when the object changed on the server since it was loaded. */
  force?: boolean;
}

export type SaveResult = { ok: true; item: Item } | { ok: false; conflict: Item } | { ok: false; error: ApiError };

const nonEmptyObj = (v: unknown): v is Obj => isObj(v) && Object.keys(v).length > 0;

/**
 * The PATCH body that turns `before` into `after` under APISIX's merge (core.table.merge): only the
 * keys that changed; a removed key as null; a nested object that is non-empty on both sides as its
 * own patch (APISIX merges those, so a removed nested key must be sent as null too); anything else
 * (arrays, scalars, an empty object on either side, which APISIX replaces) as the new value.
 */
export function mergePatch(before: Obj, after: Obj): Obj {
  const patch: Obj = {};
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) patch[key] = null;
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (deepEqual(old, value)) continue;
    patch[key] = nonEmptyObj(old) && nonEmptyObj(value) ? mergePatch(old, value) : value;
  }
  return patch;
}

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError('http', err instanceof Error ? err.message : String(err), { cause: err });
}

/** What only a write's response can tell about the object: its id (APISIX generates one on POST) and its timestamps. */
const SERVER_ONLY = ['id', 'create_time', 'update_time'];

/**
 * The stored object after a write, read back with GET. Never the write's response: it carries no
 * modifiedIndex (the next conflict check needs it), and it echoes secrets as APISIX stored them
 * (checked on 3.20): a plugin's `encrypt_fields` in any kind as `$ENC$v1$…`, which a GET returns in
 * clear, and a PEM private key (an SSL's `key`, an upstream's or an inline upstream's
 * `tls.client_key`) as AES ciphertext. Put in a draft and saved again, a `$ENC$` value would be
 * encrypted twice and the real secret lost.
 * When the read fails, what was sent stands in, for every kind; the response gives only what it alone
 * knows (SERVER_ONLY: the id APISIX assigned, the timestamps) and the item's id, no other value. An
 * SSL's `key` / `keys` are left out, as a GET leaves them out (the next save is then a PATCH that
 * keeps the stored key). It has no modifiedIndex, so the next save of it reports a conflict instead
 * of overwriting blindly.
 */
async function reread(client: AdminClient, kind: Kind, written: Item, sent: Obj, parent?: Parent): Promise<Item> {
  try {
    return await client.get(kind, written.id, parent);
  } catch {
    const value: Obj = { ...sent };
    for (const key of SERVER_ONLY) if (written.value[key] !== undefined) value[key] = written.value[key];
    if (kind === 'ssls') {
      delete value.key;
      delete value.keys;
    }
    return { id: written.id, value };
  }
}

/**
 * Saves a draft: create (POST, or PUT with an id) or edit (full PUT), with the timestamps APISIX
 * refuses stripped. An edit first re-reads the object; when its modifiedIndex moved since `original`
 * was loaded (someone else saved) it writes nothing and returns the server's item as `conflict`,
 * unless `force`. SSL is the exception to the full PUT: the private key can't be read back, so
 * unless the draft carries a new `key`, only the changes go, as a PATCH (see mergePatch) computed
 * against the server's current value. Never throws.
 */
export async function saveResource(client: AdminClient, a: SaveArgs): Promise<SaveResult> {
  const body = stripTimestamps(a.draft);
  try {
    if (a.isNew) {
      const created = await client.create(a.kind, body, a.id, a.parent);
      return { ok: true, item: await reread(client, a.kind, created, body, a.parent) };
    }
    if (a.id === undefined) throw new Error('saving an existing object needs its id');
    const current = await client.get(a.kind, a.id, a.parent);
    if (!a.force && current.modifiedIndex !== a.original?.modifiedIndex) return { ok: false, conflict: current };
    const written =
      a.kind === 'ssls' && !Object.hasOwn(body, 'key')
        ? await client.patch(a.kind, a.id, mergePatch(stripTimestamps(current.value), body))
        : await client.replace(a.kind, a.id, body, a.parent);
    return { ok: true, item: await reread(client, a.kind, written, body, a.parent) };
  } catch (err) {
    return { ok: false, error: asApiError(err) };
  }
}
