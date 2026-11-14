import { describe, expect, it } from 'vitest';
import { readPair, writePair } from './pairs';

const PAIRS = [
  ['host', 'hosts', 'a.example', 'b.example'],
  ['uri', 'uris', '/a', '/b/*'],
  ['remote_addr', 'remote_addrs', '10.0.0.1', '192.168.0.0/16'],
] as const;

describe.each(PAIRS)('%s / %s', (single, plural, one, two) => {
  it('reads whichever key is set', () => {
    expect(readPair({ [single]: one }, single, plural)).toEqual([one]);
    expect(readPair({ [plural]: [one, two] }, single, plural)).toEqual([one, two]);
    expect(readPair({ [plural]: [one] }, single, plural)).toEqual([one]);
    expect(readPair({}, single, plural)).toEqual([]);
  });

  it('reads the single key when a draft (invalidly) has both', () => {
    expect(readPair({ [single]: one, [plural]: [two] }, single, plural)).toEqual([one]);
  });

  it('writes one value as the single key, several as the plural one, none as neither', () => {
    const base = { name: 'r', other: 1 };
    expect(writePair({ ...base, [plural]: [one, two] }, single, plural, [one])).toEqual({ ...base, [single]: one });
    expect(writePair({ ...base, [single]: one }, single, plural, [one, two])).toEqual({ ...base, [plural]: [one, two] });
    expect(writePair({ ...base, [single]: one }, single, plural, [])).toEqual(base);
    expect(writePair({ ...base, [plural]: [one, two] }, single, plural, [])).toEqual(base);
  });

  it('always removes the other key of the pair, also from a draft that had both', () => {
    const both = { [single]: one, [plural]: [two] };
    expect(writePair(both, single, plural, [two])).toEqual({ [single]: two });
    expect(writePair(both, single, plural, [one, two])).toEqual({ [plural]: [one, two] });
    expect(writePair(both, single, plural, [])).toEqual({});
  });

  it('never changes the draft it is given', () => {
    const draft = { [plural]: [one] };
    const copy = structuredClone(draft);
    writePair(draft, single, plural, [one, two]);
    expect(draft).toEqual(copy);
  });
});

it('hosts: ["a"] reads as one host and is written back as host after an edit', () => {
  const loaded = { hosts: ['a'] };
  const values = readPair(loaded, 'host', 'hosts');
  expect(writePair(loaded, 'host', 'hosts', values)).toEqual({ host: 'a' });
});
