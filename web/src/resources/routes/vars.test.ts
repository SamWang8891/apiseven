import { describe, expect, it } from 'vitest';
import { blankRow, conditionOf, edited, representable, rowsFor, rowsOf, valueOfRows } from './vars';

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
    // lua-resty-expr compares list items with == and no tonumber: 1 and "1" differ, and tags can't show which.
    ['`in` with a number in its list', ['post_arg.id', 'in', [1, 2]]],
    ['`in` with a mixed list', ['a', 'in', ['x', 1]]],
    ['`ipmatch` with a number in its list', ['remote_addr', 'ipmatch', [1]]],
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
    const value = [['arg_id', 'IN', ['a', 'b']], ['remote_addr', '!', 'ipmatch', '10.0.0.0/8'], ['arg_n', '==', 2], ['post_arg.tags', 'has', 7]];
    expect(valueOfRows(rowsOf(value))).toEqual(value);
  });
});

describe('a row that holds input keeps its last good condition in the value', () => {
  it('in its place, between the others', () => {
    const rows = rowsOf([['a', '==', '1'], ['b', '>', 2], ['c', '==', '3']]);
    const held = rows.map((row, i) => (i === 1 ? edited(row, { text: 'abc' }) : row));
    expect(valueOfRows(held)).toEqual([['a', '==', '1'], ['b', '>', 2], ['c', '==', '3']]);
    // Fixed, the new condition takes its place.
    const fixed = held.map((row, i) => (i === 1 ? edited(row, { text: '3' }) : row));
    expect(valueOfRows(fixed)).toEqual([['a', '==', '1'], ['b', '>', 3], ['c', '==', '3']]);
    // Held again, the last good one is the fixed one.
    const again = fixed.map((row, i) => (i === 1 ? edited(row, { variable: '' }) : row));
    expect(valueOfRows(again)).toEqual([['a', '==', '1'], ['b', '>', 3], ['c', '==', '3']]);
  });

  it('a row that never had a condition puts nothing in the value while it holds', () => {
    const rows = [...rowsOf([['a', '==', '1']]), edited(blankRow(), { text: 'v' })];
    expect(valueOfRows(rows)).toEqual([['a', '==', '1']]);
  });

  it('a number stays a number for has, ~~ and ~*, as it does for == and ~=', () => {
    for (const op of ['has', '~~', '~*', '==', '~=']) {
      const [row] = rowsOf([['x', op, 7]]);
      if (!row) throw new Error('no row');
      expect(valueOfRows([edited(row, { not: true })]), op).toEqual([['x', '!', op, 7]]);
    }
  });
});

describe('rows for a value from outside (fix round 2)', () => {
  it('a held row whose condition the value no longer has is kept as a new row that sends nothing', () => {
    const rows = rowsOf([['a', '==', '1'], ['b', '>', 2]]);
    const held = rows.map((row, i) => (i === 1 ? edited(row, { text: 'abc' }) : row));
    // Elsewhere, b's condition was removed.
    const next = rowsFor([['a', '==', '1']], held);
    expect(next).toHaveLength(2);
    expect(next[1]?.text).toBe('abc');
    expect(valueOfRows(next)).toEqual([['a', '==', '1']]);
    // An edit to another row later does not send b's old condition again.
    const later = next.map((row, i) => (i === 0 ? edited(row, { text: '2' }) : row));
    expect(valueOfRows(later)).toEqual([['a', '==', '2']]);
  });

  it('two held rows with the same last condition, against a value holding it once: it is sent once', () => {
    const rows = rowsOf([['a', '>', 1], ['a', '>', 1]]).map((row) => edited(row, { text: 'x' }));
    expect(valueOfRows(rows)).toEqual([['a', '>', 1], ['a', '>', 1]]);
    const next = rowsFor([['a', '>', 1]], rows);
    expect(valueOfRows(next)).toEqual([['a', '>', 1]]);
  });
});
