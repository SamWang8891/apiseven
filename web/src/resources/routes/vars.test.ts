import { describe, expect, it } from 'vitest';
import { conditionOf, representable, rowsOf, valueOfRows } from './vars';

describe('which conditions the rows can show', () => {
  it.each([
    [['arg_a', '==', '1']],
    [['arg_a', '!', '~~', '^a']],
    [['arg_age', '>', 18]],
    [['arg_id', 'IN', ['a', 'b']]],
    [['remote_addr', 'ipmatch', '10.0.0.0/8']],
    [['http_x', 'has', 'v']],
  ])('%j', (raw) => {
    expect(conditionOf(raw)).toBeDefined();
  });

  it.each([
    ['the two-element shorthand', ['arg_a', '1']],
    ['a group', ['OR', ['a', '==', '1'], ['b', '==', '2']]],
    ['a variable named like a logic operator', ['and', '==', '1']],
    ['four elements without "!"', ['a', 'x', '==', '1']],
    ['an unknown operator', ['a', '=~', '1']],
    ['`in` with a string', ['a', 'in', 'x']],
    ['an object value', ['a', '==', { x: 1 }]],
    ['a nested list', [['a', '==', '1']]],
  ])('not %s', (_, raw) => {
    expect(conditionOf(raw)).toBeUndefined();
  });

  it('a value is representable when it is nothing or a flat list of conditions', () => {
    expect(representable(undefined)).toBe(true);
    expect(representable([])).toBe(true);
    expect(representable([['a', '==', '1']])).toBe(true);
    expect(representable([['a', '==', '1'], ['OR', ['a', '==', '1'], ['b', '==', '2']]])).toBe(false);
    expect(representable({})).toBe(false);
  });

  it('rows made from a value give it back unchanged, an uppercase operator and a string ipmatch included', () => {
    const value = [['arg_id', 'IN', ['a', 1]], ['remote_addr', '!', 'ipmatch', '10.0.0.0/8'], ['arg_n', '==', 2]];
    expect(valueOfRows(rowsOf(value))).toEqual(value);
  });
});
