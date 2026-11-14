import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { deepEqual, getPath, removeAt, setPath, setPathRaw, useDraft } from './draft';

/** A deep copy, to prove an input was not changed. */
const clone = <T>(v: T): T => structuredClone(v);

describe('getPath', () => {
  const o: Obj = { a: { b: [10, { c: 'x' }] }, n: null };

  it('walks objects and arrays', () => {
    expect(getPath(o, ['a', 'b', 1, 'c'])).toBe('x');
    expect(getPath(o, ['a', 'b', 0])).toBe(10);
    expect(getPath(o, [])).toBe(o);
  });

  it('is undefined for anything missing or not a container', () => {
    expect(getPath(o, ['a', 'x', 'y'])).toBeUndefined();
    expect(getPath(o, ['a', 'b', 5])).toBeUndefined();
    expect(getPath(o, ['a', 'b', 0, 'z'])).toBeUndefined();
    expect(getPath(o, ['n', 'z'])).toBeUndefined();
  });
});

describe('setPath', () => {
  it('sets a nested value, creating objects (and arrays for numeric keys) on the way', () => {
    expect(setPath({}, ['a', 'b'], 1)).toEqual({ a: { b: 1 } });
    expect(setPath({}, ['nodes', 0, 'host'], 'h')).toEqual({ nodes: [{ host: 'h' }] });
  });

  it("setPath(o, ['a','b'], '') deletes b, and deletes a when it becomes empty", () => {
    expect(setPath({ a: { b: 'x' }, keep: 1 }, ['a', 'b'], '')).toEqual({ keep: 1 });
    expect(setPath({ a: { b: 'x', c: 2 } }, ['a', 'b'], '')).toEqual({ a: { c: 2 } });
  });

  it('deletes on undefined, [] and {} too, but keeps 0, false and null', () => {
    for (const empty of [undefined, '', [], {}]) {
      expect(setPath({ a: 1, b: 2 }, ['b'], empty), JSON.stringify(empty)).toEqual({ a: 1 });
    }
    expect(setPath({}, ['a'], 0)).toEqual({ a: 0 });
    expect(setPath({}, ['a'], false)).toEqual({ a: false });
    expect(setPath({}, ['a'], null)).toEqual({ a: null });
  });

  it('prunes every parent that becomes empty, but stops at the root', () => {
    expect(setPath({ a: { b: { c: { d: 1 } } } }, ['a', 'b', 'c', 'd'], undefined)).toEqual({});
    expect(setPath({ a: { b: { c: 1 }, x: 1 } }, ['a', 'b', 'c'], undefined)).toEqual({ a: { x: 1 } });
  });

  it('addresses arrays by index', () => {
    expect(setPath({ l: ['a', 'b', 'c'] }, ['l', 1], 'B')).toEqual({ l: ['a', 'B', 'c'] });
  });

  it('never removes or reorders array elements: an empty value is written into the element', () => {
    const o: Obj = { l: ['a', 'b', 'c'] };
    expect(setPath(o, ['l', 1], undefined)).toBe(o);
    expect(setPath({ l: ['a', 'b'], k: 1 }, ['l', 1], '')).toEqual({ l: ['a', ''], k: 1 });
    expect(setPath({ l: ['a'] }, ['l', 0], {})).toEqual({ l: [{}] });
  });

  it('prunes emptied objects up to, but not through, the nearest array: rows stay in place', () => {
    expect(setPath({ l: [{ host: 'h' }] }, ['l', 0, 'host'], '')).toEqual({ l: [{}] });
    expect(setPath({ l: [{ x: 1 }, { y: 2 }] }, ['l', 0, 'x'], '')).toEqual({ l: [{}, { y: 2 }] });
    expect(setPath({ u: { nodes: [{ host: 'h', port: 1 }] } }, ['u', 'nodes', 0, 'host'], '')).toEqual({ u: { nodes: [{ port: 1 }] } });
    expect(setPath({ l: [{ a: { b: 1 } }] }, ['l', 0, 'a', 'b'], undefined)).toEqual({ l: [{}] });
  });

  it('a whole array set to [] still deletes its key', () => {
    expect(setPath({ nodes: [{ host: 'h' }], k: 1 }, ['nodes'], [])).toEqual({ k: 1 });
  });

  it('never changes its input, and returns the same object when deleting something absent', () => {
    const o: Obj = { a: { b: [1, 2] }, c: 'x' };
    const before = clone(o);
    setPath(o, ['a', 'b', 0], 9);
    setPath(o, ['a', 'b'], []);
    setPath(o, ['c'], undefined);
    setPath(o, ['z', 'y'], 1);
    expect(o).toEqual(before);
    expect(setPath(o, ['missing', 'deep'], undefined)).toBe(o);
  });

  it('keeps untouched branches by reference', () => {
    const o: Obj = { a: { x: 1 }, b: { y: 2 } };
    const next = setPath(o, ['a', 'x'], 3);
    expect(next.b).toBe(o.b);
  });
});

describe('setPathRaw', () => {
  it("keeps an empty object: setPathRaw(o, ['plugins','key-auth'], {})", () => {
    expect(setPathRaw({}, ['plugins', 'key-auth'], {})).toEqual({ plugins: { 'key-auth': {} } });
    expect(setPathRaw({ l: [1] }, ['l'], [])).toEqual({ l: [] });
    expect(setPathRaw({ s: 'x' }, ['s'], '')).toEqual({ s: '' });
  });

  it('deletes only on undefined, never prunes the parents, and never removes an array element', () => {
    expect(setPathRaw({ a: { b: 1 } }, ['a', 'b'], undefined)).toEqual({ a: {} });
    const o: Obj = { l: ['x'] };
    expect(setPathRaw(o, ['l', 0], undefined)).toBe(o);
  });

  it('never changes its input', () => {
    const o: Obj = { plugins: { cors: {} } };
    const before = clone(o);
    setPathRaw(o, ['plugins', 'key-auth'], {});
    setPathRaw(o, ['plugins', 'cors'], undefined);
    expect(o).toEqual(before);
  });
});

describe('removeAt', () => {
  it('removes one element, keeping the order of the rest', () => {
    expect(removeAt({ l: ['a', 'b', 'c'] }, ['l'], 1)).toEqual({ l: ['a', 'c'] });
    expect(removeAt({ u: { nodes: [{ h: 1 }, { h: 2 }] } }, ['u', 'nodes'], 0)).toEqual({ u: { nodes: [{ h: 2 }] } });
  });

  it('deletes the key once the array is empty, pruning emptied objects up to the nearest array', () => {
    expect(removeAt({ u: { nodes: [{ h: 1 }] }, k: 1 }, ['u', 'nodes'], 0)).toEqual({ k: 1 });
    expect(removeAt({ ups: [{ nodes: [1] }] }, ['ups', 0, 'nodes'], 0)).toEqual({ ups: [{}] });
  });

  it('returns the object itself for an index out of range or a path that is not an array', () => {
    const o: Obj = { l: ['a'], s: 'x' };
    expect(removeAt(o, ['l'], 1)).toBe(o);
    expect(removeAt(o, ['l'], -1)).toBe(o);
    expect(removeAt(o, ['s'], 0)).toBe(o);
    expect(removeAt(o, ['missing'], 0)).toBe(o);
  });

  it('never changes its input', () => {
    const o: Obj = { l: [{ a: 1 }, { b: 2 }] };
    const before = clone(o);
    removeAt(o, ['l'], 0);
    expect(o).toEqual(before);
  });
});

describe('deepEqual', () => {
  it('compares JSON values structurally; key order does not matter, array order does', () => {
    expect(deepEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: [] }, { a: {} })).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('useDraft', () => {
  it('is dirty after a change and clean again once the original value is restored', () => {
    const { result } = renderHook(() => useDraft({ uri: '/a', x: { y: 1 } }));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft(setPath(result.current.draft, ['uri'], '/b')));
    expect(result.current.dirty).toBe(true);
    expect(result.current.draft).toEqual({ uri: '/b', x: { y: 1 } });
    act(() => result.current.setDraft(setPath(result.current.draft, ['uri'], '/a')));
    expect(result.current.dirty).toBe(false);
  });

  it('reset() goes back to the baseline; reset(to) makes `to` the new baseline', () => {
    const { result } = renderHook(() => useDraft({ a: 1 }));
    act(() => result.current.setDraft({ a: 2 }));
    act(() => result.current.reset());
    expect(result.current.draft).toEqual({ a: 1 });
    expect(result.current.dirty).toBe(false);
    act(() => result.current.reset({ a: 3 }));
    expect(result.current.draft).toEqual({ a: 3 });
    expect(result.current.dirty).toBe(false);
  });

  it('can start from a draft that differs from its baseline (a duplicate starts dirty)', () => {
    const { result } = renderHook(() => useDraft({ name: 'web' }, { name: 'web copy' }));
    expect(result.current.draft).toEqual({ name: 'web copy' });
    expect(result.current.dirty).toBe(true);
  });
});
