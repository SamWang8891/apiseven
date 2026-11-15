// Which SNIs a certificate's DNS names cover, as browsers match them (RFC 6125 6.4: exact, or a
// wildcard that is the whole left-most label and covers exactly one label; no partial-label
// wildcards; case-insensitive). This is what a client accepts, not APISIX's SNI router (resolve.ts).
import { describe, expect, it } from 'vitest';
import { EC_IPV6, NO_SAN, RSA_LEAF } from '../../test/certs';
import { parseCert } from './parseCert';
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
    expect(uncoveredSnis([sni], dns, [])).toEqual(covered ? [] : [sni]);
  });

  it('keeps the uncovered ones in their order, each once; a reference is not judged', () => {
    expect(uncoveredSnis(['b.test', 'a.test', 'x.ok.test', 'b.test', '$env://SNI'], ['*.ok.test'], [])).toEqual(['b.test', 'a.test']);
  });

  it('an IP address SNI (APISIX takes one, schema_def.lua 57) is compared with the IP names, by value (fix round 1, R9)', () => {
    const leaf = parseCert(RSA_LEAF);
    const v6 = parseCert(EC_IPV6);
    expect(leaf?.ips).toEqual(['10.0.0.1']);
    expect(v6?.ips).toEqual(['2001:db8:0:0:0:0:0:1', '0:0:0:0:0:0:0:1']);
    expect(uncoveredSnis(['10.0.0.1', '10.0.0.2'], leaf?.dns ?? [], leaf?.ips ?? [])).toEqual(['10.0.0.2']);
    // IPv6 by value, however it is spelled; brackets as in a host.
    expect(uncoveredSnis(['2001:DB8::1', '[::1]', '::2'], v6?.dns ?? [], v6?.ips ?? [])).toEqual(['::2']);
    // An IP name never covers a DNS SNI that looks alike, nor the other way round.
    expect(uncoveredSnis(['10.0.0.1'], ['10.0.0.1'], [])).toEqual(['10.0.0.1']);
  });

  it('a name only in the subject CN is not named: browsers read the SANs alone', () => {
    const noSan = parseCert(NO_SAN);
    expect(noSan?.subject).toContain('CN=nosan.internal');
    expect(uncoveredSnis(['nosan.internal'], noSan?.dns ?? [], noSan?.ips ?? [])).toEqual(['nosan.internal']);
  });
});
