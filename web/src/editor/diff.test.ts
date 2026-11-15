import { describe, expect, it } from 'vitest';
import { hunks, lineDiff } from './diff';

const ops = (a: string, b: string) => lineDiff(a, b).map((l) => `${l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '}${l.text}`);

describe('lineDiff', () => {
  it('marks changed lines and keeps the rest in order', () => {
    expect(ops('a\nb\nc', 'a\nB\nc')).toEqual([' a', '-b', '+B', ' c']);
  });

  it('handles insertions and deletions at either end', () => {
    expect(ops('b\nc', 'a\nb\nc\nd')).toEqual(['+a', ' b', ' c', '+d']);
    expect(ops('a\nb\nc', 'b')).toEqual(['-a', ' b', '-c']);
  });

  it('identical texts are all unchanged; an empty side is all added or removed', () => {
    expect(ops('x\ny', 'x\ny')).toEqual([' x', ' y']);
    expect(ops('', 'x')).toEqual(['-', '+x']);
  });

  it('finds the longest common run (a moved key reads as one removal and one addition)', () => {
    expect(ops('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}', '{\n  "b": 2,\n  "c": 3,\n  "a": 1\n}')).toEqual([
      ' {',
      '-  "a": 1,',
      '   "b": 2,',
      '-  "c": 3',
      '+  "c": 3,',
      '+  "a": 1',
      ' }',
    ]);
  });
});

describe('hunks', () => {
  it('folds long unchanged runs, keeping the given context around each change', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l10', 'L10');
    const out = hunks(lineDiff(a, b), 2);
    expect(out.map((h) => (h.op === 'skip' ? `…${h.count}` : `${h.op}:${h.text}`))).toEqual([
      '…8',
      'same:l8',
      'same:l9',
      'del:l10',
      'add:L10',
      'same:l11',
      'same:l12',
      '…7',
    ]);
  });

  it('does not fold a run shorter than what folding would save', () => {
    // With one line of context, only `c` is outside it: a fold line in its place would save nothing.
    const out = hunks(lineDiff('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE'), 1);
    expect(out.some((h) => h.op === 'skip')).toBe(false);
    expect(out).toHaveLength(7);
  });
});

// Final wave C3: a legal route can hold 140,000 short labels (no entry-count limit, under the 1.5 MiB
// request limit); spreading that many unchanged lines into push() overflowed the call stack.
describe('a large object', () => {
  const labels = Object.fromEntries(Array.from({ length: 140_000 }, (_, i) => [`k${i}`, 'v']));
  // Keys sorted, as the dialog shows them (editor/json.ts canonical): `host` comes before the labels.
  const text = (host: string) => JSON.stringify({ host, id: 'r1', labels, uri: '/' }, null, 2);

  it('diffs without overflowing the stack, the unchanged lines folded around the change', () => {
    const lines = lineDiff(text('a.example'), text('b.example'));
    expect(lines.filter((l) => l.op !== 'same').map((l) => `${l.op}:${l.text}`)).toEqual(['del:  "host": "a.example",', 'add:  "host": "b.example",']);
    const out = hunks(lines);
    expect(out.length).toBeLessThan(12);
    expect(out.find((h) => h.op === 'skip')).toEqual({ op: 'skip', count: 140_002 });
  });

  it('a change at each end (the middle too big to align) is all removed then all added, without overflowing', () => {
    const before = JSON.stringify({ a: 1, labels, z: 1 }, null, 2);
    const after = JSON.stringify({ a: 2, labels, z: 2 }, null, 2);
    const lines = lineDiff(before, after);
    // "a", the labels' 140,002 lines (opening and closing included) and "z", on each side.
    expect(lines.filter((l) => l.op === 'del')).toHaveLength(140_004);
    expect(lines.filter((l) => l.op === 'add')).toHaveLength(140_004);
  });
});
