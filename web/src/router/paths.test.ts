import { describe, expect, it } from 'vitest';
import { kindFromSegment, newPathFor, pathFor } from './paths';

describe('pathFor', () => {
  it('gives the list path of a kind', () => {
    expect(pathFor('routes')).toBe('/routes');
    expect(pathFor('stream_routes')).toBe('/stream_routes');
  });

  it('encodes ids, slashes included', () => {
    expect(pathFor('routes', 'r1')).toBe('/routes/r1');
    expect(pathFor('consumers', 'a/b')).toBe('/consumers/a%2Fb');
    expect(pathFor('routes', 'a b?c#d%')).toBe('/routes/a%20b%3Fc%23d%25');
    expect(pathFor('secrets', 'vault/my id')).toBe('/secrets/vault%2Fmy%20id');
  });

  it('nests credentials under their consumer', () => {
    expect(pathFor('credentials', 'c1', { consumer: 'jo e' })).toBe('/consumers/jo%20e/credentials/c1');
    expect(pathFor('credentials', 'c 1', { consumer: 'a/b' })).toBe('/consumers/a%2Fb/credentials/c%201');
  });

  it('refuses credentials without a consumer', () => {
    expect(() => pathFor('credentials', 'c1')).toThrow(/consumer/);
  });
});

describe('newPathFor', () => {
  // Task 16b item 14: "~" is in no APISIX id (^[a-zA-Z0-9-_.]+$), so no object's path is the create page's.
  it('gives the create path, a segment no id can equal', () => {
    expect(newPathFor('routes')).toBe('/routes/~new');
    expect(newPathFor('credentials', { consumer: 'jo e' })).toBe('/consumers/jo%20e/credentials/~new');
    expect(newPathFor('routes')).not.toBe(pathFor('routes', 'new'));
  });
});

describe('kindFromSegment', () => {
  it('accepts every top-level kind, exactly as written in the URL', () => {
    for (const kind of [
      'routes', 'services', 'upstreams', 'consumers', 'consumer_groups', 'ssls', 'global_rules',
      'plugin_configs', 'plugin_metadata', 'protos', 'secrets', 'stream_routes',
    ]) {
      expect(kindFromSegment(kind)).toBe(kind);
    }
  });

  it('rejects anything else', () => {
    expect(kindFromSegment('nope')).toBeUndefined();
    expect(kindFromSegment(undefined)).toBeUndefined();
    expect(kindFromSegment('')).toBeUndefined();
    expect(kindFromSegment('Routes')).toBeUndefined();
    expect(kindFromSegment('credentials')).toBeUndefined();
    expect(kindFromSegment('toString')).toBeUndefined();
  });
});
