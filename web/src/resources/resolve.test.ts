import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { EC_IPV6, FAR } from '../test/certs';
import { ctxOf, itemOf } from '../test/ctx';
import { effectivePlugins, labelPairs, nameOfValue, referencesTo, resolveRef, routeHosts, sniList, sslExpiries, sslForHost, upstreamSummary } from './resolve';

describe('nameOfValue', () => {
  it('takes name, then username, then desc, skipping empty strings', () => {
    expect(nameOfValue({ name: 'n', username: 'u', desc: 'd' })).toBe('n');
    expect(nameOfValue({ name: '', username: 'u', desc: 'd' })).toBe('u');
    expect(nameOfValue({ desc: 'd' })).toBe('d');
    expect(nameOfValue({ name: 3 })).toBeUndefined();
    expect(nameOfValue({})).toBeUndefined();
  });
});

describe('routeHosts', () => {
  const ctx = ctxOf({ services: [itemOf('web', { hosts: ['apiseven.test', 'www.apiseven.test'] }), itemOf('bare')] });

  it("uses the route's own hosts, not the service's", () => {
    expect(routeHosts({ hosts: ['a.test', 'b.test'], service_id: 'web' }, ctx)).toEqual({
      hosts: ['a.test', 'b.test'],
      viaService: false,
    });
  });

  it("uses the route's own single host", () => {
    expect(routeHosts({ host: 'a.test', service_id: 'web' }, ctx)).toEqual({ hosts: ['a.test'], viaService: false });
  });

  it("falls back to the bound service's hosts", () => {
    expect(routeHosts({ uri: '/*', service_id: 'web' }, ctx)).toEqual({
      hosts: ['apiseven.test', 'www.apiseven.test'],
      viaService: true,
    });
  });

  it('compares the service id as a string', () => {
    const numeric = ctxOf({ services: [itemOf('1', { hosts: ['one.test'] })] });
    expect(routeHosts({ service_id: 1 }, numeric)).toEqual({ hosts: ['one.test'], viaService: true });
  });

  it('has no hosts when neither the route nor its service has any', () => {
    expect(routeHosts({ uri: '/*' }, ctx)).toEqual({ hosts: [], viaService: false });
    expect(routeHosts({ service_id: 'bare' }, ctx)).toEqual({ hosts: [], viaService: false });
    expect(routeHosts({ service_id: 'gone' }, ctx)).toEqual({ hosts: [], viaService: false });
  });
});

describe('upstreamSummary: a service with both upstream_id and an inline upstream (Ruling 4)', () => {
  const ctx = ctxOf({
    upstreams: [itemOf('u1', { name: 'pool', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] })],
    services: [itemOf('s1', { name: 'both', upstream_id: 'u1', upstream: { nodes: [{ host: '10.0.9.9', port: 3000, weight: 1 }] } })],
  });

  it('a route (http) takes its upstream_id: handle_upstream reads it first (apisix/init.lua 724–733)', () => {
    expect(upstreamSummary({ service_id: 's1' }, ctx)).toEqual({ label: 'both', nodes: ['10.0.0.1:80'], source: 'service', refId: 's1' });
  });

  it('a stream route takes its inline upstream (merge_service_stream_route, plugin.lua 793–799; init.lua 1922–1934)', () => {
    expect(upstreamSummary({ service_id: 's1' }, ctx, 'stream')).toEqual({ label: 'both', nodes: ['10.0.9.9:3000'], source: 'service', refId: 's1' });
  });

  it('either way, the object\'s own upstream_id wins over the service (init.lua 724 and 1894)', () => {
    expect(upstreamSummary({ service_id: 's1', upstream_id: 'u1' }, ctx, 'stream').source).toBe('upstream');
  });
});

describe('upstreamSummary', () => {
  const pool = itemOf('web-pool', {
    name: 'web-pool',
    nodes: [
      { host: '10.0.0.11', port: 8080, weight: 1 },
      { host: '10.0.0.12', port: 8080, weight: 1 },
    ],
  });
  const unnamed = itemOf('unnamed', { nodes: { '10.0.9.1:80': 1, '10.0.9.2:80': 1, '10.0.9.3:80': 1 } });
  const consul = itemOf('consul-up', { discovery_type: 'consul', service_name: 'billing', type: 'roundrobin' });
  const ctx = ctxOf({
    upstreams: [pool, unnamed, consul, itemOf('1', { name: 'numeric', nodes: { 'n.test:80': 1 } })],
    services: [
      itemOf('web', { name: 'web', upstream_id: 'web-pool' }),
      itemOf('billing', { name: 'billing', upstream: { nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] } }),
      itemOf('anon', { upstream_id: 'unnamed' }),
      itemOf('empty', { name: 'empty' }),
      itemOf('broken', { name: 'broken', upstream_id: 'gone' }),
    ],
  });

  it('gives the same nodes for the map and the array shape', () => {
    const map = upstreamSummary({ upstream: { nodes: { '10.0.0.1:80': 1, 'b.test:8080': 2 } } }, ctx);
    const array = upstreamSummary(
      {
        upstream: {
          nodes: [
            { host: '10.0.0.1', port: 80, weight: 1 },
            { host: 'b.test', port: 8080, weight: 2 },
          ],
        },
      },
      ctx,
    );
    expect(map.nodes).toEqual(['10.0.0.1:80', 'b.test:8080']);
    expect(array.nodes).toEqual(map.nodes);
    expect(array).toEqual({ label: '10.0.0.1:80 +1', nodes: ['10.0.0.1:80', 'b.test:8080'], source: 'inline' });
  });

  it('omits an absent port, and brackets an IPv6 host when it adds one', () => {
    const summary = upstreamSummary(
      {
        upstream: {
          nodes: [
            { host: 'httpbin.org', weight: 1 },
            { host: '::1', port: 80, weight: 1 },
          ],
        },
      },
      ctx,
    );
    expect(summary.nodes).toEqual(['httpbin.org', '[::1]:80']);
  });

  it('summarises a discovery upstream as <discovery_type>:<service_name>', () => {
    expect(upstreamSummary({ upstream: { discovery_type: 'consul', service_name: 'name' } }, ctx)).toEqual({
      label: 'consul:name',
      nodes: [],
      source: 'inline',
    });
    expect(upstreamSummary({ upstream_id: 'consul-up' }, ctx)).toEqual({
      label: 'consul:billing',
      nodes: [],
      source: 'upstream',
      refId: 'consul-up',
    });
  });

  it('labels a referenced upstream by its name', () => {
    expect(upstreamSummary({ upstream_id: 'web-pool' }, ctx)).toEqual({
      label: 'web-pool',
      nodes: ['10.0.0.11:8080', '10.0.0.12:8080'],
      source: 'upstream',
      refId: 'web-pool',
    });
  });

  it('labels an unnamed upstream by its first node and the count of the rest', () => {
    expect(upstreamSummary({ upstream_id: 'unnamed' }, ctx).label).toBe('10.0.9.1:80 +2');
    expect(upstreamSummary({ upstream: { nodes: [{ host: 'one.test', port: 80, weight: 1 }] } }, ctx).label).toBe(
      'one.test:80',
    );
  });

  it('reports an upstream_id that points nowhere as missing', () => {
    expect(upstreamSummary({ upstream_id: 'gone' }, ctx)).toEqual({
      label: t('ui.empty'),
      nodes: [],
      source: 'missing',
      refId: 'gone',
    });
  });

  it('compares upstream ids as strings', () => {
    expect(upstreamSummary({ upstream_id: 1 }, ctx)).toMatchObject({ source: 'upstream', refId: '1', label: 'numeric' });
  });

  it('prefers upstream_id over an inline upstream, as APISIX does', () => {
    const both = { upstream_id: 'web-pool', upstream: { nodes: { 'inline.test:80': 1 } } };
    expect(upstreamSummary(both, ctx)).toMatchObject({ source: 'upstream', refId: 'web-pool' });
  });

  it("works for a service object's own upstream", () => {
    const service = (id: string) => ctx.services.find((s) => s.id === id)?.value ?? {};
    expect(upstreamSummary(service('web'), ctx)).toMatchObject({ source: 'upstream', refId: 'web-pool' });
    expect(upstreamSummary(service('billing'), ctx)).toEqual({
      label: '10.0.1.20:3000',
      nodes: ['10.0.1.20:3000'],
      source: 'inline',
    });
  });

  it("resolves a route through its service's upstream_id", () => {
    expect(upstreamSummary({ uri: '/*', service_id: 'web' }, ctx)).toEqual({
      label: 'web',
      nodes: ['10.0.0.11:8080', '10.0.0.12:8080'],
      source: 'service',
      refId: 'web',
    });
  });

  it("resolves a route or stream route through its service's inline upstream", () => {
    const expected = { label: 'billing', nodes: ['10.0.1.20:3000'], source: 'service', refId: 'billing' };
    expect(upstreamSummary({ uri: '/billing/*', service_id: 'billing' }, ctx)).toEqual(expected);
    expect(upstreamSummary({ server_port: 9100, service_id: 'billing' }, ctx)).toEqual(expected);
  });

  it('labels a service-sourced upstream by the upstream when the service has no name', () => {
    expect(upstreamSummary({ service_id: 'anon' }, ctx)).toMatchObject({ label: '10.0.9.1:80 +2', source: 'service' });
  });

  it("prefers the route's own upstream over its service's", () => {
    expect(upstreamSummary({ service_id: 'web', upstream_id: 'unnamed' }, ctx)).toMatchObject({
      source: 'upstream',
      refId: 'unnamed',
    });
    expect(upstreamSummary({ service_id: 'web', upstream: { nodes: { 'own.test:80': 1 } } }, ctx)).toMatchObject({
      source: 'inline',
      nodes: ['own.test:80'],
    });
  });

  it("reports the service's dangling upstream_id as missing", () => {
    expect(upstreamSummary({ service_id: 'broken' }, ctx)).toEqual({
      label: t('ui.empty'),
      nodes: [],
      source: 'missing',
      refId: 'gone',
    });
  });

  it('has none when nothing gives an upstream', () => {
    const none = { label: t('ui.empty'), nodes: [], source: 'none' };
    expect(upstreamSummary({ uri: '/healthz', plugins: { mocking: {} } }, ctx)).toEqual(none);
    expect(upstreamSummary({ service_id: 'empty' }, ctx)).toEqual(none);
    expect(upstreamSummary({ service_id: 'gone' }, ctx)).toEqual(none);
    expect(upstreamSummary({ upstream: { nodes: [] } }, ctx)).toEqual({ ...none, source: 'inline' });
  });
});

describe('effectivePlugins', () => {
  const ctx = ctxOf({
    pluginConfigs: [itemOf('pc', { plugins: { cors: { from: 'pc' }, gzip: {}, 'response-rewrite': {} } })],
    services: [itemOf('svc', { plugins: { cors: { from: 'svc' }, gzip: {}, 'limit-req': { _meta: { disable: true } } } })],
  });

  it('gives one entry per plugin, route over plugin config over service, sorted by name', () => {
    const route = { plugins: { cors: {}, 'key-auth': {} }, plugin_config_id: 'pc', service_id: 'svc' };
    expect(effectivePlugins(route, ctx)).toEqual([
      { name: 'cors', from: 'route', disabled: false },
      { name: 'gzip', from: 'plugin_config', disabled: false },
      { name: 'key-auth', from: 'route', disabled: false },
      { name: 'limit-req', from: 'service', disabled: true },
      { name: 'response-rewrite', from: 'plugin_config', disabled: false },
    ]);
  });

  it('marks a plugin disabled only when _meta.disable is true', () => {
    const route = {
      plugins: { a: { _meta: { disable: true } }, b: { _meta: { disable: false } }, c: { _meta: {} }, d: 'odd' },
    };
    expect(effectivePlugins(route, ctx).map((p) => [p.name, p.disabled])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', false],
    ]);
  });

  it('compares ids as strings and skips references that point nowhere', () => {
    const numeric = ctxOf({ services: [itemOf('7', { plugins: { gzip: {} } })] });
    expect(effectivePlugins({ service_id: 7 }, numeric)).toEqual([{ name: 'gzip', from: 'service', disabled: false }]);
    expect(effectivePlugins({ plugin_config_id: 'gone', service_id: 'gone' }, ctx)).toEqual([]);
    expect(effectivePlugins({}, ctx)).toEqual([]);
  });
});

describe('sslForHost', () => {
  const ssl = (id: string, value: Record<string, unknown>) => itemOf(id, { type: 'server', ...value });

  it('matches a one-level wildcard SNI, not deeper hosts or the bare domain', () => {
    const ctx = ctxOf({ ssls: [ssl('wild', { snis: ['*.example.org'] })] });
    expect(sslForHost('a.example.org', ctx)?.item.id).toBe('wild');
    expect(sslForHost('a.b.example.org', ctx)).toBeUndefined();
    expect(sslForHost('example.org', ctx)).toBeUndefined();
    expect(sslForHost('a.example.com', ctx)).toBeUndefined();
  });

  it('reads the single sni field too', () => {
    const ctx = ctxOf({ ssls: [ssl('one', { sni: 'api.test' })] });
    expect(sslForHost('api.test', ctx)?.item.id).toBe('one');
  });

  it('ignores client certificates', () => {
    const ctx = ctxOf({ ssls: [ssl('client', { type: 'client', snis: ['api.test'] })] });
    expect(sslForHost('api.test', ctx)).toBeUndefined();
  });

  it('ignores a disabled certificate, which APISIX does not serve', () => {
    const ctx = ctxOf({ ssls: [ssl('off', { snis: ['api.test'], status: 0 }), ssl('on', { snis: ['*.test'] })] });
    expect(sslForHost('api.test', ctx)?.item.id).toBe('on');
  });

  it('prefers an exact SNI over a wildcard', () => {
    const ctx = ctxOf({
      ssls: [
        ssl('wild', { snis: ['*.example.org'], validity_end: 2_000_000_000 }),
        ssl('exact', { snis: ['a.example.org'], validity_end: 1_900_000_000 }),
      ],
    });
    expect(sslForHost('a.example.org', ctx)?.item.id).toBe('exact');
  });

  it('several certificates with the same SNI: APISIX serves the one it loaded first, so the others are named as shared', () => {
    // radixtree keeps routes of one path in insertion order (insert_tab_in_order with sort_route:
    // equal priority and path length never reorder), and the SNI router inserts them in load order:
    // etcd key order after a restart, a later object after the others (config_etcd.lua 578, 848).
    // Checked on the dev APISIX: of two SSLs with the same SNI, the one created first is served,
    // whatever its expiry. The list (key order) is only a guess at that order.
    const ctx = ctxOf({
      ssls: [
        ssl('unknown', { snis: ['a.test'] }),
        ssl('later', { snis: ['a.test'], validity_end: 1_900_000_000 }),
        ssl('earlier', { snis: ['a.test'], validity_end: 1_800_000_000 }),
      ],
    });
    const match = sslForHost('a.test', ctx);
    expect(match?.item.id).toBe('unknown');
    expect(match?.shared.map((item) => item.id)).toEqual(['later', 'earlier']);
    expect(sslForHost('b.test', ctxOf({ ssls: [ssl('one', { snis: ['b.test'] })] }))?.shared).toEqual([]);
  });

  it('a certificate stored without a type is a server certificate (the schema default, applied when APISIX loads it)', () => {
    const ctx = ctxOf({ ssls: [itemOf('plain', { snis: ['api.test'] })] });
    expect(sslForHost('api.test', ctx)?.item.id).toBe('plain');
  });

  it('routes by snis when it is a non-empty list, else by sni (radixtree_sni.lua 56–64)', () => {
    const ctx = ctxOf({ ssls: [ssl('both', { sni: 'one.test', snis: ['two.test'] }), ssl('empty', { sni: 'three.test', snis: [] })] });
    expect(sslForHost('two.test', ctx)?.item.id).toBe('both');
    expect(sslForHost('one.test', ctx)).toBeUndefined();
    expect(sslForHost('three.test', ctx)?.item.id).toBe('empty');
  });

  it('the longest wildcard decides, with no second try: a deeper name than it covers gets no certificate', () => {
    // radixtree tries the longest prefix first and the SNI check that follows (188–215) never goes back
    // to a shorter one. Checked live: *foo.probe.test and a catch-all sni "*" give x.foo.probe.test no certificate.
    const ctx = ctxOf({ ssls: [ssl('all', { sni: '*' }), ssl('foo', { snis: ['*foo.example.org'] })] });
    expect(sslForHost('foo.example.org', ctx)?.item.id).toBe('foo');
    expect(sslForHost('xfoo.example.org', ctx)?.item.id).toBe('foo');
    expect(sslForHost('x.foo.example.org', ctx)).toBeUndefined();
    expect(sslForHost('other.test', ctx)?.item.id).toBe('all');
  });

  it('"*" as the single sni serves every name; in an snis list only names without a dot', () => {
    expect(sslForHost('a.b.test', ctxOf({ ssls: [ssl('single', { sni: '*' })] }))?.item.id).toBe('single');
    const listed = ctxOf({ ssls: [ssl('listed', { snis: ['*'] })] });
    expect(sslForHost('localhost', listed)?.item.id).toBe('listed');
    expect(sslForHost('a.test', listed)).toBeUndefined();
  });

  it('a longer SNI in the same list lets a wildcard serve deeper names too, as APISIX does', () => {
    // The check passes when no dot follows at the length of any SNI in the list (radixtree_sni.lua
    // 192–198), so a long name in the list waves a deeper host through. Checked live on 3.20.
    const ctx = ctxOf({ ssls: [ssl('wild', { snis: ['*.wild.test', 'averyveryveryverylongname.example.org'] })] });
    expect(sslForHost('a.b.wild.test', ctx)?.item.id).toBe('wild');
    expect(sslForHost('a.wild.test', ctx)?.item.id).toBe('wild');
  });

  it('ignores a trailing dot on either side (ssl.lua 68, radixtree_sni.lua 294–299)', () => {
    const ctx = ctxOf({ ssls: [ssl('dot', { snis: ['Api.Test.'] })] });
    expect(sslForHost('api.test', ctx)?.item.id).toBe('dot');
    expect(sslForHost('API.test.', ctx)?.item.id).toBe('dot');
  });

  it('gives no certificate for an address: a client sends no SNI for one (RFC 6066 3), and there is no fallback_sni', () => {
    const ctx = ctxOf({ ssls: [ssl('ip', { snis: ['10.0.0.1'] }), ssl('all', { sni: '*' })] });
    expect(sslForHost('10.0.0.1', ctx)).toBeUndefined();
    expect(sslForHost('[::1]', ctx)).toBeUndefined();
  });

  it('compares hostnames case-insensitively', () => {
    const ctx = ctxOf({ ssls: [ssl('plain', { snis: ['example.org'] }), ssl('wild', { snis: ['*.Example.ORG'] })] });
    expect(sslForHost('EXAMPLE.org', ctx)?.item.id).toBe('plain');
    expect(sslForHost('WWW.example.org', ctx)?.item.id).toBe('wild');
  });

  it('matches a wildcard host only to the same wildcard SNI', () => {
    const ctx = ctxOf({ ssls: [ssl('one', { snis: ['a.apiseven.test'] }), ssl('wild', { snis: ['*.apiseven.test'] })] });
    expect(sslForHost('*.apiseven.test', ctx)?.item.id).toBe('wild');
    expect(sslForHost('*.other.test', ctx)).toBeUndefined();
  });

  it('gives notAfter in milliseconds from validity_end in seconds, else undefined', () => {
    const ctx = ctxOf({
      ssls: [ssl('dated', { snis: ['a.test'], validity_end: 1_800_000_000 }), ssl('plain', { snis: ['b.test'] })],
    });
    expect(sslForHost('a.test', ctx)).toEqual({ item: ctx.ssls[0], notAfter: 1_800_000_000_000, shared: [] });
    expect(sslForHost('b.test', ctx)?.notAfter).toBeUndefined();
  });

  it('reads notAfter from the certificate when there is no validity_end (APISIX 3.7+)', () => {
    const ctx = ctxOf({
      ssls: [ssl('far', { snis: ['a.test'], cert: FAR }), ssl('junk', { snis: ['b.test'], cert: 'not a PEM' })],
    });
    expect(sslForHost('a.test', ctx)?.notAfter).toBe(Date.UTC(2051, 5, 30, 23, 59, 59));
    expect(sslForHost('b.test', ctx)?.notAfter).toBeUndefined();
  });

  it('prefers validity_end over the certificate', () => {
    const ctx = ctxOf({ ssls: [ssl('both', { snis: ['a.test'], cert: FAR, validity_end: 1_800_000_000 })] });
    expect(sslForHost('a.test', ctx)?.notAfter).toBe(1_800_000_000_000);
  });

  it('reads each shared certificate\'s expiry from its own certificate', () => {
    const ctx = ctxOf({
      ssls: [ssl('soon', { snis: ['a.test'], cert: EC_IPV6 }), ssl('far', { snis: ['a.test'], cert: FAR })],
    });
    expect(sslForHost('a.test', ctx)?.item.id).toBe('soon');
    expect(sslExpiries(sslForHost('a.test', ctx))).toEqual([Date.UTC(2027, 10, 14, 13, 47, 19), Date.UTC(2051, 5, 30, 23, 59, 59)]);
  });
});

describe('sniList', () => {
  it('is what the router reads: snis when non-empty, else sni; lower-cased, a trailing dot dropped', () => {
    expect(sniList({ snis: ['A.test.', '*.B.test'] })).toEqual(['a.test', '*.b.test']);
    expect(sniList({ sni: 'One.Test', snis: [] })).toEqual(['one.test']);
    expect(sniList({ type: 'client' })).toEqual([]);
  });
});

describe('referencesTo', () => {
  const ctx = ctxOf({
    routes: [
      itemOf('r-up', { name: 'zeta', upstream_id: 'u1' }),
      itemOf('r-num', { name: 'alpha', upstream_id: 1 }),
      itemOf('r-svc', { name: 'via-svc', service_id: 's1', plugin_config_id: 'pc1' }),
      itemOf('r-other', { upstream_id: 'u2' }),
      itemOf('r-proto', { name: 'grpc', plugins: { 'grpc-transcode': { proto_id: 'p1' } } }),
      itemOf('r-split', {
        name: 'split',
        plugins: {
          'traffic-split': { rules: [{ weighted_upstreams: [{ weight: 1 }, { upstream_id: 'u1', weight: 1 }] }] },
        },
      }),
      itemOf('r-tls', { name: 'mtls', upstream: { nodes: {}, tls: { client_cert_id: 'c1' } } }),
    ],
    services: [
      itemOf('s1', { name: 'svc-one', upstream_id: 'u1' }),
      itemOf('s-proto', { desc: 'proto user', plugins: { 'grpc-transcode': { proto_id: 'p1' } } }),
    ],
    streamRoutes: [itemOf('sr1', { upstream_id: 'u1' }), itemOf('sr2', { service_id: 's1' })],
    upstreams: [itemOf('u1', { name: 'u-one' }), itemOf('u-tls', { name: 'mtls-up', tls: { client_cert_id: 'c1' } })],
    pluginConfigs: [
      itemOf('pc-proto', { name: 'pc-grpc', plugins: { 'grpc-transcode': { proto_id: 'p1' } } }),
      itemOf('pc-split', { plugins: { 'traffic-split': { rules: [{ weighted_upstreams: [{ upstream_id: 'u1' }] }] } } }),
    ],
    consumers: [itemOf('alice', { username: 'alice', group_id: 'g1' }), itemOf('bob', { username: 'bob' })],
    consumerGroups: [itemOf('g1', { name: 'partners' })],
  });

  it('finds what uses an upstream (traffic-split included), sorted by kind then name', () => {
    expect(referencesTo('upstreams', 'u1', ctx)).toEqual([
      { kind: 'plugin_configs', id: 'pc-split', name: 'pc-split' },
      { kind: 'routes', id: 'r-split', name: 'split' },
      { kind: 'routes', id: 'r-up', name: 'zeta' },
      { kind: 'services', id: 's1', name: 'svc-one' },
      { kind: 'stream_routes', id: 'sr1', name: 'sr1' },
    ]);
  });

  it('matches a numeric upstream_id to a string id', () => {
    expect(referencesTo('upstreams', '1', ctx)).toEqual([{ kind: 'routes', id: 'r-num', name: 'alpha' }]);
  });

  it('finds the routes and stream routes bound to a service', () => {
    expect(referencesTo('services', 's1', ctx)).toEqual([
      { kind: 'routes', id: 'r-svc', name: 'via-svc' },
      { kind: 'stream_routes', id: 'sr2', name: 'sr2' },
    ]);
  });

  it('finds the routes using a plugin config', () => {
    expect(referencesTo('plugin_configs', 'pc1', ctx)).toEqual([{ kind: 'routes', id: 'r-svc', name: 'via-svc' }]);
  });

  it('finds the consumers in a consumer group', () => {
    expect(referencesTo('consumer_groups', 'g1', ctx)).toEqual([{ kind: 'consumers', id: 'alice', name: 'alice' }]);
  });

  it('finds the upstreams, and inline upstreams, using an SSL as their client certificate', () => {
    expect(referencesTo('ssls', 'c1', ctx)).toEqual([
      { kind: 'routes', id: 'r-tls', name: 'mtls' },
      { kind: 'upstreams', id: 'u-tls', name: 'mtls-up' },
    ]);
  });

  it('finds the routes, services and plugin configs whose grpc-transcode uses a proto', () => {
    expect(referencesTo('protos', 'p1', ctx)).toEqual([
      { kind: 'plugin_configs', id: 'pc-proto', name: 'pc-grpc' },
      { kind: 'routes', id: 'r-proto', name: 'grpc' },
      { kind: 'services', id: 's-proto', name: 'proto user' },
    ]);
  });

  it('gives nothing for an unused id or a kind nothing references', () => {
    expect(referencesTo('upstreams', 'unused', ctx)).toEqual([]);
    expect(referencesTo('routes', 'r-up', ctx)).toEqual([]);
    expect(referencesTo('consumers', 'alice', ctx)).toEqual([]);
    expect(referencesTo('global_rules', 'g', ctx)).toEqual([]);
    expect(referencesTo('secrets', 'vault/1', ctx)).toEqual([]);
  });
});

describe('resolveRef', () => {
  const ctx = ctxOf({ services: [itemOf('s1', { name: 'web' }), itemOf('7')], pluginConfigs: [itemOf('pc1')] });

  it('finds the object a reference field names, numeric ids included', () => {
    expect(resolveRef('services', 's1', ctx)).toEqual({ id: 's1', item: ctx.services[0] });
    expect(resolveRef('services', 7, ctx)).toEqual({ id: '7', item: ctx.services[1] });
    expect(resolveRef('plugin_configs', 'pc1', ctx)?.item).toBe(ctx.pluginConfigs[0]);
  });

  it('keeps the id of a dangling reference, and is undefined for an unset one', () => {
    expect(resolveRef('services', 'gone', ctx)).toEqual({ id: 'gone', item: undefined });
    expect(resolveRef('services', undefined, ctx)).toBeUndefined();
    expect(resolveRef('services', '', ctx)).toBeUndefined();
  });
});

describe('labelPairs', () => {
  it('lists string labels in stored order and skips anything else', () => {
    expect(labelPairs({ team: 'core', env: 'dev', n: 1 })).toEqual([['team', 'core'], ['env', 'dev']]);
    expect(labelPairs(undefined)).toEqual([]);
    expect(labelPairs(['a'])).toEqual([]);
  });
});
