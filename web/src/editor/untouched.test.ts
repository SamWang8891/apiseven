// The parts of the rule for required values on a new object (Task 16b, item 154; fix round 1, R1) that
// are pure: what changed, what only says a value is missing, and what the user touched.
import { describe, expect, it } from 'vitest';
import { changedPaths, onlyMissing, touchedAt } from './untouched';

describe('changedPaths', () => {
  it('every path that differs, containers included; nothing and nothing are the same', () => {
    expect(changedPaths({ a: 1, b: { c: 1, d: 2 } }, { a: 1, b: { c: 1, d: 3 } })).toEqual(['', 'b', 'b.d']);
    expect(changedPaths({ cert: 'x' }, {})).toEqual(['', 'cert']);
    expect(changedPaths({ a: [1] }, { a: [1] })).toEqual([]);
    expect(changedPaths({ name: '' }, { name: null, x: {} })).toEqual([]);
  });

  it('what a new plugin card or row brings in is recorded only where it holds a value', () => {
    expect(changedPaths({ uri: '/a' }, { uri: '/a', plugins: { 'limit-count': {} } })).toEqual(['', 'plugins']);
    expect(changedPaths({ nodes: [] }, { nodes: [{ host: '', port: 80 }] })).toEqual(['', 'nodes', 'nodes.0', 'nodes.0.port']);
  });
});

describe('onlyMissing', () => {
  const draft = { name: '', gone: null, hosts: [], timeout: {}, uri: '/a', upstream: { nodes: [{ host: 'h' }] }, map: { '10.0.0.1:80': null } };
  it('nothing at a path that resolves (no value, null, "", [] or {}), or an issue that says so itself', () => {
    for (const path of ['cert', 'name', 'gone', 'hosts', 'timeout', 'timeout.connect', 'upstream.nodes.0.port']) expect(onlyMissing({ path, message: '' }, draft), path).toBe(true);
    for (const path of ['uri', 'upstream.nodes.0.host', 'upstream']) expect(onlyMissing({ path, message: '' }, draft), path).toBe(false);
    expect(onlyMissing({ path: '', message: '' }, draft)).toBe(false);
    expect(onlyMissing({ path: '', message: '', missing: true }, draft)).toBe(true);
  });

  it('a path that does not resolve in the draft is not "only missing": a map row named by place, a key holding a "." (fail open)', () => {
    for (const path of ['map.0.weight', 'upstream.nodes.1.host', 'headers.a.b']) expect(onlyMissing({ path, message: '' }, draft), path).toBe(false);
  });
});

describe('touchedAt', () => {
  const touched = new Set(['', 'upstream', 'upstream.nodes', 'upstream.nodes.0', 'upstream.nodes.0.host', 'plugins']);
  it('the path itself or below it; never above it, never the object as a whole', () => {
    expect(touchedAt('upstream.nodes.0.host', touched)).toBe(true);
    expect(touchedAt('upstream.nodes', touched)).toBe(true);
    expect(touchedAt('plugins', touched)).toBe(true);
    expect(touchedAt('plugins.cors.allow_origins', touched)).toBe(false);
    expect(touchedAt('upstream.timeout', touched)).toBe(false);
    expect(touchedAt('plugins2', touched)).toBe(false);
    expect(touchedAt('', touched)).toBe(false);
  });
});
