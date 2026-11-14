import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { deref, expand, resolveRef, testPattern } from './refs';

const root: Obj = {
  definitions: {
    host: { type: 'string', description: 'host' },
    'a/b': { type: 'integer' },
    'pct%': { type: 'boolean' },
    alias: { $ref: '#/definitions/host' },
    loopA: { $ref: '#/definitions/loopB' },
    loopB: { $ref: '#/definitions/loopA' },
  },
  $defs: { port: { type: 'integer' } },
};

describe('resolveRef', () => {
  it('follows local JSON pointers, with ~1 / ~0 and %-escapes decoded', () => {
    expect(resolveRef(root, '#/definitions/host')).toEqual({ type: 'string', description: 'host' });
    expect(resolveRef(root, '#/definitions/a~1b')).toEqual({ type: 'integer' });
    expect(resolveRef(root, '#/definitions/pct%25')).toEqual({ type: 'boolean' });
    expect(resolveRef(root, '#/$defs/port')).toEqual({ type: 'integer' });
    expect(resolveRef(root, '#')).toBe(root);
  });

  it('gives undefined for remote refs, missing targets and malformed escapes, without throwing', () => {
    expect(resolveRef(root, 'http://example.com/schema#/x')).toBeUndefined();
    expect(resolveRef(root, '#/definitions/nope')).toBeUndefined();
    expect(resolveRef(root, '#/definitions/%')).toBeUndefined();
    expect(resolveRef(root, '#/definitions/%E0%A4%A')).toBeUndefined();
  });
});

describe('deref', () => {
  it('follows a chain of $refs to the schema that has content', () => {
    expect(deref(root, { $ref: '#/definitions/alias' })).toEqual({ type: 'string', description: 'host' });
    const plain = { type: 'string' };
    expect(deref(root, plain)).toBe(plain);
  });

  it('gives undefined for a circular chain or a dangling ref', () => {
    expect(deref(root, { $ref: '#/definitions/loopA' })).toBeUndefined();
    const self: Obj = { $ref: '#' };
    expect(deref(self, self)).toBeUndefined();
    expect(deref(root, { $ref: '#/nope' })).toBeUndefined();
    expect(deref(root, 5)).toBeUndefined();
  });
});

describe('expand', () => {
  it('collects the schema and what it pulls in through $ref, allOf/anyOf/oneOf and then/else', () => {
    const schema: Obj = {
      allOf: [{ $ref: '#/definitions/host' }],
      oneOf: [{ type: 'integer' }],
      then: { minLength: 2 },
    };
    const all = expand({ ...root, ...schema }, schema);
    expect(all).toContainEqual({ type: 'string', description: 'host' });
    expect(all).toContainEqual({ type: 'integer' });
    expect(all).toContainEqual({ minLength: 2 });
  });

  it('stops at cycles instead of recursing until the depth cap', () => {
    const cyclic: Obj = { anyOf: [] };
    (cyclic.anyOf as unknown[]).push(cyclic, { $ref: '#' });
    const out = expand(cyclic, cyclic);
    expect(out).toEqual([cyclic]);
    expect(expand(root, { $ref: '#/definitions/loopA' })).toEqual([]);
  });
});

describe('testPattern', () => {
  it('tests a JSON Schema pattern, and treats one that does not compile as matching', () => {
    expect(testPattern('^[^:]+$', 'X-Api')).toBe(true);
    expect(testPattern('^[^:]+$', 'a:b')).toBe(false);
    expect(testPattern('([', 'anything')).toBe(true);
  });
});
