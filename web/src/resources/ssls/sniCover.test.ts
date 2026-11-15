// Which SNIs a certificate's DNS names cover, as browsers match them (RFC 6125 6.4: exact, or a
// wildcard that is the whole left-most label and covers exactly one label; no partial-label
// wildcards; case-insensitive). This is what a client accepts, not APISIX's SNI router (resolve.ts).
import { describe, expect, it } from 'vitest';
import { uncoveredSnis } from './sniCover';

describe('uncoveredSnis', () => {
  it.each([
    ['an exact name', 'a.test', ['a.test'], true],
    ['case does not matter', 'API.Example.test', ['api.example.TEST'], true],
    ['a wildcard covers one label', 'x.a.test', ['*.a.test'], true],
    ['not the bare domain', 'a.test', ['*.a.test'], false],
    ['not two labels', 'y.x.a.test', ['*.a.test'], false],
    ['no partial-label wildcard (prefix)', 'foo.a.test', ['f*.a.test'], false],
    ['no partial-label wildcard (suffix)', 'foo.a.test', ['*o.a.test'], false],
    ['a wildcard only as the left-most label', 'x.y.test', ['x.*.test'], false],
    ['a wildcard SNI: the same wildcard covers it', '*.a.test', ['*.a.test'], true],
    ['a wildcard SNI: names under it do not cover all it stands for', '*.a.test', ['x.a.test', 'y.a.test'], false],
    ['a wildcard SNI: a wider wildcard is not the same names', '*.a.test', ['*.test'], false],
    ['the catch-all SNI is never named', '*', ['*.a.test', 'a.test'], false],
    ['no names at all', 'a.test', [], false],
    ['a trailing dot on either side', 'a.test.', ['a.test'], true],
  ])('%s: %s by %j', (_, sni, dns, covered) => {
    expect(uncoveredSnis([sni], dns)).toEqual(covered ? [] : [sni]);
  });

  it('keeps the uncovered ones in their order, each once; a reference is not judged', () => {
    expect(uncoveredSnis(['b.test', 'a.test', 'x.ok.test', 'b.test', '$env://SNI'], ['*.ok.test'])).toEqual(['b.test', 'a.test']);
  });
});
