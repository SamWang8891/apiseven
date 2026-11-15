// The parts of the rule for required values on a new object (Task 16b, item 154) that are pure: what
// changed, what only says a value is missing, and what the user touched.
import { describe, expect, it } from 'vitest';
import { changedPaths, onlyMissing, touchedAt } from './untouched';

describe('changedPaths', () => {
  it('the deepest paths that differ; a key or a row on one side only, whole', () => {
    expect(changedPaths({ a: 1, b: { c: 1, d: 2 } }, { a: 1, b: { c: 1, d: 3 } })).toEqual(['b.d']);
    expect(changedPaths({ a: 1 }, { a: 1, plugins: { cors: {} } })).toEqual(['plugins']);
    expect(changedPaths({ nodes: [{ host: 'a' }] }, { nodes: [{ host: 'b' }, { host: 'c' }] })).toEqual(['nodes.0.host', 'nodes.1']);
    expect(changedPaths({ cert: 'x' }, {})).toEqual(['cert']);
    expect(changedPaths({ a: [1] }, { a: [1] })).toEqual([]);
  });
});

describe('onlyMissing', () => {
  const draft = { name: '', hosts: [], timeout: {}, uri: '/a', upstream: { nodes: [{ host: 'h' }] } };
  it('nothing at the path (no key, "", [] or {}), or an issue that says so itself', () => {
    for (const path of ['cert', 'name', 'hosts', 'timeout', 'upstream.nodes.1.host', 'timeout.connect']) expect(onlyMissing({ path, message: '' }, draft), path).toBe(true);
    for (const path of ['uri', 'upstream.nodes.0.host', 'upstream']) expect(onlyMissing({ path, message: '' }, draft), path).toBe(false);
    expect(onlyMissing({ path: '', message: '' }, draft)).toBe(false);
    expect(onlyMissing({ path: '', message: '', missing: true }, draft)).toBe(true);
  });
});

describe('touchedAt', () => {
  const touched = new Set(['upstream.nodes.0.host', 'plugins']);
  it('the path itself, below it, or above it; never the object as a whole', () => {
    expect(touchedAt('upstream.nodes.0.host', touched)).toBe(true);
    expect(touchedAt('upstream.nodes', touched)).toBe(true);
    expect(touchedAt('plugins.cors.allow_origins', touched)).toBe(true);
    expect(touchedAt('upstream.timeout', touched)).toBe(false);
    expect(touchedAt('plugins2', touched)).toBe(false);
    expect(touchedAt('', touched)).toBe(false);
  });
});
