// The additional certificate/key pairs (`certs` / `keys`, e.g. ECDSA beside RSA) as the draft holds
// them. APISIX never returns a key (admin/resource.lua 180–193), so a stored pair's key is not in the
// draft; it stays in APISIX while the save, a PATCH for every stored SSL (editor/save.ts), sends no
// `keys`, because `keys` is replaced whole when sent (core.table.merge replaces arrays). So a change
// to the pairs means every remaining key is entered again: `keys` then lines up with `certs`, with
// null where a key is still to be entered (sslIssues refuses those). A change that ends where it began
// (the stored certs, no key entered) is no change: `keys` goes again (settled). Checked live: a PATCH
// of certs + keys with every key works; certs alone that changes their number is refused; removing
// them all needs `keys: []` (`keys: null` crashes APISIX's PATCH, a 500); `{cert, key}` keeps them.
import { deepEqual } from '../../editor/draft';
import type { Obj } from '../../api/types';

/**
 * A pair's key, as the next save treats it: `stored` (APISIX keeps it), `entered` (in the draft,
 * never shown), `needed` (the save would leave this cert without its key), or `stale` (APISIX keeps
 * the stored key in this place, but it was stored for another certificate: the certs changed in the
 * JSON without their keys, which APISIX accepts as long as their number stays).
 */
export type KeyState = 'stored' | 'entered' | 'needed' | 'stale';

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Whether the save keeps the stored extra keys: a stored object (always a PATCH) that sends no `keys`. */
const keepsStoredKeys = (draft: Obj, isNew: boolean): boolean => !isNew && draft.keys === undefined;

/** Each additional pair's key state, in order (see KeyState). `original` is the stored object. */
export function keyStates(draft: Obj, isNew: boolean, original?: Obj): KeyState[] {
  const certs = list(draft.certs);
  if (Array.isArray(draft.keys)) {
    const keys = draft.keys;
    return certs.map((_, i) => (typeof keys[i] === 'string' ? 'entered' : 'needed'));
  }
  if (!keepsStoredKeys(draft, isNew)) return certs.map(() => 'needed');
  const stored = list(original?.certs);
  if (stored.length !== certs.length) return certs.map(() => 'needed');
  return certs.map((cert, i) => (stored[i] === cert ? 'stored' : 'stale'));
}

/** The keys lined up with the certs: what the draft has, null where a key is still to be entered. */
function alignedKeys(draft: Obj): (string | null)[] {
  const keys = list(draft.keys);
  return list(draft.certs).map((_, i) => {
    const key = keys[i];
    return typeof key === 'string' ? key : null;
  });
}

/**
 * A stored SSL whose pairs ended where they began (the stored certs, in order, and no key entered):
 * `keys` goes, and every stored key stays (a way back from add-then-remove).
 */
function settled(next: Obj, isNew: boolean, original: Obj | undefined): Obj {
  if (isNew || !Array.isArray(next.keys) || next.keys.some((k) => k !== null)) return next;
  if (!deepEqual(list(next.certs), list(original?.certs))) return next;
  const out = { ...next };
  delete out.keys;
  if (list(original?.certs).length === 0) delete out.certs;
  return out;
}

/** `draft` with a pair added at the end; every other pair's key is then to be entered again (unless it already is). */
export function withPairAdded(draft: Obj, cert: string, key: string): Obj {
  return { ...draft, certs: [...list(draft.certs), cert], keys: [...alignedKeys(draft), key] };
}

/**
 * `draft` without pair `index`; the others' keys are to be entered again (unless they already are,
 * or the pairs are back as stored: settled). With none left, both lists go, except that a stored
 * object sends `keys: []` so that APISIX drops the stored keys too (mergePatch sends `certs: null`).
 */
export function withPairRemoved(draft: Obj, index: number, isNew: boolean, original?: Obj): Obj {
  const certs = list(draft.certs).filter((_, i) => i !== index);
  const keys = alignedKeys(draft).filter((_, i) => i !== index);
  const next: Obj = { ...draft, certs, keys };
  if (certs.length > 0) return settled(next, isNew, original);
  delete next.certs;
  delete next.keys;
  const storedPairs = list(original?.certs).length > 0;
  if (!isNew && storedPairs) next.keys = [];
  return next;
}

/** `draft` with the key of pair `index` entered; the other pairs' keys as they are, or to be entered. */
export function withKeyEntered(draft: Obj, index: number, key: string): Obj {
  const keys = alignedKeys(draft);
  keys[index] = key;
  return { ...draft, keys };
}
