// The editor's draft: one plain JSON object for the whole resource, changed only through immutable
// path updates. Tabs write their own fields with setPath (empty values delete the key, so a cleared
// field leaves nothing behind) or setPathRaw (when {} or [] means something, e.g. a plugin enabled
// with no options), and remove list rows with removeAt: nothing else ever shortens an array. Fields
// no tab models are never touched.
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

/** A shallow copy of `c` with `key` set to `value`; for an object, undefined removes the key. */
function assign(c: Container, key: string | number, value: unknown): Container {
  if (Array.isArray(c)) {
    const copy = [...c];
    copy[Number(key)] = value;
    return copy;
  }
  const copy: Obj = { ...c };
  if (value === undefined) delete copy[String(key)];
  else copy[String(key)] = value;
  return copy;
}

/**
 * Sets `value` at `path` in a copy of `c` (only the containers along the path are copied). Missing
 * containers are created: an array when the key after them is a number, else an object.
 * - An object key is deleted by undefined, and with `prune` by any empty value; with `prune`, an
 *   object left empty by that is deleted from its parent object in turn.
 * - An array element is never removed and an array never shrinks (removeAt does that): an empty
 *   value is written into the element as it is, undefined leaves the element alone, and pruning
 *   stops at the array, which keeps an element even when it became {}.
 */
function update(c: Container, path: Path, value: unknown, prune: boolean): Container {
  const [key, ...rest] = path;
  if (key === undefined) return c;
  const inArray = Array.isArray(c);
  const removes = value === undefined || (prune && isEmptyValue(value));
  if (rest.length === 0) {
    if (inArray) return value === undefined ? c : assign(c, key, value);
    if (removes) return Object.hasOwn(c, String(key)) ? assign(c, key, undefined) : c;
    return assign(c, key, value);
  }
  const child = inArray ? c[Number(key)] : c[String(key)];
  if (!isContainer(child)) {
    if (removes) return c;
    return assign(c, key, update(typeof rest[0] === 'number' ? [] : {}, rest, value, prune));
  }
  const next = update(child, rest, value, prune);
  if (next === child) return c;
  return assign(c, key, prune && !inArray && isEmptyValue(next) ? undefined : next);
}

/**
 * Immutable set. At an object key, a value of undefined, '', [] or {} DELETES the key instead, and
 * every object left empty by that is deleted from its parent too, up to (not through) the nearest
 * array; the root object stays, possibly empty. Arrays are addressed by index and are never
 * shortened or reordered: an empty value is written into the element, undefined changes nothing,
 * and a row emptied of its fields stays as {} (remove rows with removeAt). Setting a whole array to
 * [] at an object key deletes that key. Returns `obj` itself when nothing changes.
 */
export function setPath(obj: Obj, path: Path, value: unknown): Obj {
  return update(obj, path, value, true) as Obj;
}

/**
 * Immutable set of exactly `value` ({}, [] and '' included). Only undefined deletes an object key;
 * nothing is pruned; array elements are never removed (undefined at an index changes nothing).
 */
export function setPathRaw(obj: Obj, path: Path, value: unknown): Obj {
  return update(obj, path, value, false) as Obj;
}

/**
 * Removes element `index` of the array at `path` (a list row), keeping the others in order. When
 * the array becomes empty its key is deleted, and objects left empty are pruned as setPath does.
 * Returns `obj` itself when `path` holds no array or `index` is out of range.
 */
export function removeAt(obj: Obj, path: Path, index: number): Obj {
  const list = getPath(obj, path);
  if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) return obj;
  return setPath(obj, path, list.filter((_, i) => i !== index));
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
