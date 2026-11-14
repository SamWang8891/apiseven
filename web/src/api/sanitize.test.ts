import { describe, expect, it } from 'vitest';
import { isObj, stripTimestamps } from './sanitize';

describe('stripTimestamps', () => {
  const body = {
    id: 'r1',
    uri: '/a',
    create_time: 1,
    update_time: 2,
    labels: { create_time: 'kept: not a timestamp position' },
    upstream: {
      type: 'roundrobin',
      nodes: [{ host: '10.0.0.1', port: 80, weight: 1, update_time: 'kept: inside nodes' }],
      create_time: 3,
      update_time: 4,
    },
    plugins: {
      'limit-count': { count: 1, time_window: 60, create_time: 5, update_time: 6 },
      'key-auth': {},
      cors: { allow_origins: '*', update_time: 7 },
    },
  };

  it('removes create_time/update_time at top level, in upstream and in every plugins.*', () => {
    expect(stripTimestamps(body)).toEqual({
      id: 'r1',
      uri: '/a',
      labels: { create_time: 'kept: not a timestamp position' },
      upstream: {
        type: 'roundrobin',
        nodes: [{ host: '10.0.0.1', port: 80, weight: 1, update_time: 'kept: inside nodes' }],
      },
      plugins: {
        'limit-count': { count: 1, time_window: 60 },
        'key-auth': {},
        cors: { allow_origins: '*' },
      },
    });
  });

  it('leaves a body without timestamps deep-equal and does not modify its input', () => {
    const plain = { name: 'x', upstream_id: 'u', plugins: { gzip: { comp_level: 5 } }, vars: [['a', '==', 'b']] };
    const before = structuredClone(body);
    expect(stripTimestamps(plain)).toEqual(plain);
    stripTimestamps(body);
    expect(body).toEqual(before);
  });

  it('keeps upstream and plugins as they are when they are not objects', () => {
    const odd = { upstream: 'oops', plugins: null, create_time: 1 };
    expect(stripTimestamps(odd)).toEqual({ upstream: 'oops', plugins: null });
  });
});

describe('isObj', () => {
  it('is true only for plain objects', () => {
    expect(isObj({})).toBe(true);
    expect(isObj([])).toBe(false);
    expect(isObj(null)).toBe(false);
    expect(isObj('x')).toBe(false);
  });
});
