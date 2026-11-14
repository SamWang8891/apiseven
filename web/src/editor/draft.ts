// The editor's draft: one plain JSON object for the whole resource, changed only through immutable
// path updates. Tabs write their own fields with setPath (empty values delete the key, so a cleared
// field leaves nothing behind) or setPathRaw (when {} or [] means something, e.g. a plugin enabled
// with no options). Fields no tab models are never touched.
import { useCallback, useMemo, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';

export type Path = (string | number)[];

type Container = Obj | unknown[];

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;

/** The value at `path`; undefined when any step is missing or not an object/array. */
export function getPath(obj: Obj, path: Path): unknown {
  let at: unknown = obj;
  for (const key of path) {
    if (!isContainer(at)) return undefined;
    at = Array.isArray(at) ? at[Number(key)] : at[String(key)];
  }
  return at;
}

/** undefined, '', [] and {}: what setPath treats as "no value". 0, false and null are values. */
export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
}

/** A shallow copy of `c` with `key` set to `value`, or removed when `value` is undefined (array elements are spliced out). */
function assign(c: Container, key: string | number, value: unknown): Container {
  if (Array.isArray(c)) {
    const copy = [...c];
    const i = Number(key);
    if (value === undefined) copy.splice(i, 1);
    else copy[i] = value;
    return copy;
  }
  const copy: Obj = { ...c };
  if (value === undefined) delete copy[String(key)];
  else copy[String(key)] = value;
  return copy;
}

function has(c: Container, key: string | number): boolean {
  return Array.isArray(c) ? Number(key) < c.length : Object.hasOwn(c, String(key));
}

/**
 * Sets `value` at `path` in a copy of `c` (only the containers along the path are copied). Missing
 * containers are created: an array when the key after them is a number, else an object. A value of
 * undefined deletes; with `prune`, a container emptied that way is deleted from its parent in turn.
 */
function update(c: Container, path: Path, value: unknown, prune: boolean): Container {
  const [key, ...rest] = path;
  if (key === undefined) return c;
  if (rest.length === 0) {
    if (value === undefined && !has(c, key)) return c;
    return assign(c, key, value);
  }
  const child = Array.isArray(c) ? c[Number(key)] : c[String(key)];
  if (!isContainer(child)) {
    if (value === undefined) return c;
    return assign(c, key, update(typeof rest[0] === 'number' ? [] : {}, rest, value, prune));
  }
  const next = update(child, rest, value, prune);
  if (next === child) return c;
  return assign(c, key, prune && isEmptyValue(next) ? undefined : next);
}

/**
 * Immutable set. A value of undefined, '', [] or {} DELETES the key instead, and every parent left
 * empty by that is deleted too (the root object stays, possibly empty). Arrays are addressed by
 * index; deleting an element removes it. Returns `obj` itself when deleting something absent.
 */
export function setPath(obj: Obj, path: Path, value: unknown): Obj {
  return update(obj, path, isEmptyValue(value) ? undefined : value, true) as Obj;
}

/** Immutable set of exactly `value` ({} and [] included); only undefined deletes, and nothing is pruned. */
export function setPathRaw(obj: Obj, path: Path, value: unknown): Obj {
  return update(obj, path, value, false) as Obj;
}

/** Structural equality of JSON values: object key order is ignored, array order is not. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isContainer(a) || !isContainer(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a);
  const ob = b as Obj;
  return ka.length === Object.keys(ob).length && ka.every((k) => Object.hasOwn(ob, k) && deepEqual((a as Obj)[k], ob[k]));
}

export interface Draft {
  draft: Obj;
  /** Replace the whole draft. Build the next value from the current one, once per change. */
  setDraft: (next: Obj) => void;
  /** The draft differs from the baseline. */
  dirty: boolean;
  /** Back to the baseline; with `to`, `to` becomes the baseline and the draft. */
  reset: (to?: Obj) => void;
  /** What the draft is compared with (e.g. to mark the tabs whose fields changed). */
  baseline: Obj;
}

/**
 * The editor's working copy and the baseline it is compared with. `start` (default `initial`) lets a
 * draft begin different from its baseline, as a duplicate does (it starts dirty).
 */
export function useDraft(initial: Obj, start?: Obj): Draft {
  const [state, setState] = useState(() => ({ baseline: initial, draft: start ?? initial }));
  const dirty = useMemo(() => !deepEqual(state.draft, state.baseline), [state]);
  const setDraft = useCallback((next: Obj) => setState((s) => ({ ...s, draft: next })), []);
  const reset = useCallback((to?: Obj) => setState((s) => ({ baseline: to ?? s.baseline, draft: to ?? s.baseline })), []);
  return { draft: state.draft, setDraft, dirty, reset, baseline: state.baseline };
}
