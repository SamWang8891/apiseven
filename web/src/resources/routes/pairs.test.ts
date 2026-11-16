import { describe, expect, it } from 'vitest';
import { ctxOf, itemOf } from '../../test/ctx';
import { readPair, writePair } from './pairs';
import { routeIssues } from './validate';

const ENV = { isNew: false, ctx: ctxOf({ upstreams: [itemOf('u1')] }) };

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

// Final wave E4: `uri` is a string of 1–4096 characters, `uris` items any string (schema_def.lua 642–650).
describe('one value the single key would refuse stays in the plural key', () => {
  const long = `/${'a'.repeat(4096)}`;

  it('a URI longer than 4096 characters, left alone by a removal, stays in uris', () => {
    const loaded = { name: 'r', uris: ['/ordinary', long] };
    expect(writePair(loaded, 'uri', 'uris', [long])).toEqual({ name: 'r', uris: [long] });
  });

  it('an empty URI stays in uris; one that fits goes to uri as before', () => {
    expect(writePair({ uris: ['/a', ''] }, 'uri', 'uris', [''])).toEqual({ uris: [''] });
    expect(writePair({ uris: ['/a', long] }, 'uri', 'uris', ['/a'])).toEqual({ uri: '/a' });
    expect(writePair({ uris: ['/a', long] }, 'uri', 'uris', [`/${'a'.repeat(4095)}`])).toEqual({ uri: `/${'a'.repeat(4095)}` });
  });

  // Fix round 1, R1.2 (this expectation changed): host, remote_addr and sni follow the same rule, so a
  // value the single key refuses stays in the plural key, shown and flagged, instead of `host: ''`,
  // which readPair would not show.
  it('host, remote_addr and sni: one value the single key refuses stays in the plural key; one it takes goes to the single key', () => {
    expect(writePair({ hosts: ['a', ''] }, 'host', 'hosts', [''])).toEqual({ hosts: [''] });
    expect(writePair({ hosts: ['a', 'bad host'] }, 'host', 'hosts', ['bad host'])).toEqual({ hosts: ['bad host'] });
    expect(writePair({ hosts: ['a', 'b.test'] }, 'host', 'hosts', ['b.test'])).toEqual({ host: 'b.test' });
    expect(writePair({ remote_addrs: ['10.0.0.1', 'x'] }, 'remote_addr', 'remote_addrs', ['x'])).toEqual({ remote_addrs: ['x'] });
    expect(writePair({ remote_addrs: ['x', '10.0.0.0/8'] }, 'remote_addr', 'remote_addrs', ['10.0.0.0/8'])).toEqual({ remote_addr: '10.0.0.0/8' });
    expect(writePair({ snis: ['a.test', ''] }, 'sni', 'snis', [''])).toEqual({ snis: [''] });
    expect(writePair({ snis: ['a.test', 'b.test'] }, 'sni', 'snis', ['b.test'])).toEqual({ sni: 'b.test' });
  });

  // Fix round 2, item 4: APISIX's validator skips a string field holding a reference, so one fits the single key.
  it('a $secret:// or $env:// reference fits the single key', () => {
    expect(writePair({ snis: ['$secret://vault/1/sni', 'a.test'] }, 'sni', 'snis', ['$secret://vault/1/sni'])).toEqual({ sni: '$secret://vault/1/sni' });
    expect(writePair({ hosts: ['$ENV://HOST', 'a.test'] }, 'host', 'hosts', ['$ENV://HOST'])).toEqual({ host: '$ENV://HOST' });
  });

  it("a host kept in hosts that way stays shown and flagged by the route's check", () => {
    const next = writePair({ uri: '/x', hosts: ['a', ''] }, 'host', 'hosts', ['']);
    expect(readPair(next, 'host', 'hosts')).toEqual(['']);
    expect(routeIssues({ ...next, upstream_id: 'u1' }, ENV).map((issue) => issue.path)).toContain('hosts.0');
  });
});
