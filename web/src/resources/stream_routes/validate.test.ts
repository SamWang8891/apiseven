// What streamRouteIssues blocks: only what APISIX 3.20 refuses in a stream route (the `stream_route`
// schema in apisix/schema_def.lua, check_conf in apisix/admin/stream_routes.lua and the
// stream_route_checker it calls in apisix/stream/router/ip_port.lua).
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import { streamAddressProblem, streamRouteIssues } from './validate';

const CTX = ctxOf({
  upstreams: [itemOf('web-pool', { name: 'web-pool' })],
  services: [itemOf('web', { name: 'web' })],
  streamRoutes: [itemOf('redis-main', { protocol: { name: 'redis' } }), itemOf('plain', {})],
});
const env = { isNew: false, ctx: CTX, plugins: pluginFixture().http, streamPlugins: pluginFixture().stream };
const issues = (draft: Obj, e = env) => streamRouteIssues(draft, e).map((i) => [i.path, i.message]);
const paths = (draft: Obj, e = env) => streamRouteIssues(draft, e).map((i) => i.path);

describe('streamRouteIssues', () => {
  it('needs nothing: APISIX takes a stream route with no field at all, an upstream included', () => {
    expect(issues({})).toEqual([]);
    expect(issues({ server_port: 9100 })).toEqual([]);
  });

  it('a sound stream route of every part has no issue', () => {
    const full: Obj = {
      name: 'tls-in',
      desc: 'TLS on 9443',
      labels: { env: 'dev' },
      server_addr: '127.0.0.1',
      server_port: 9443,
      remote_addr: '10.0.0.0/8',
      snis: ['a.example', '*.b.example'],
      tls_passthrough: true,
      service_id: 'web',
      upstream_id: 'web-pool',
      plugins: { 'ip-restriction': { whitelist: ['10.0.0.0/8'] } },
      protocol: { name: 'redis', superior_id: 'redis-main', conf: { faults: [] }, logger: [{ name: 'syslog', filter: [], conf: {} }] },
    };
    expect(issues(full)).toEqual([]);
    expect(issues({ upstream: { nodes: [{ host: 'etcd', port: 2379, weight: 1 }] } })).toEqual([]);
  });

  it('server_port: a whole number from 1 to 65535', () => {
    for (const port of [0, 65536, 1.5, '9100', -1]) expect(issues({ server_port: port }), String(port)).toEqual([['server_port', t('sr.issue.port')]]);
    expect(issues({ server_port: 1 })).toEqual([]);
    expect(issues({ server_port: 65535 })).toEqual([]);
  });

  it.each(['server_addr', 'remote_addr'])('%s: the schema\'s ip_def and validate_cidr_or_ip (a prefix that fits the address)', (field) => {
    for (const ok of ['127.0.0.1', '10.0.0.0/8', '0.0.0.0/0', '::1', 'fe80::/64', '2001:db8::/32', '::ffff:10.0.0.1', '::/0', 'fe80::/064']) {
      expect(issues({ [field]: ok }), ok).toEqual([]);
    }
    // fe80::/200 passes the schema's loose IPv6/CIDR pattern, and validate_cidr_or_ip refuses it; so
    // does `:/8`, whose address does not parse.
    for (const bad of ['10.0.0.300', '10.0.0.0/33', '10.0.0.0/05', 'localhost', 'fe80::/200', ':/8', '10.0.0.1/', 'fe80::1%eth0', '']) {
      expect(issues({ [field]: bad }), bad).toEqual([[field, t('rt.issue.addr', { addr: bad })]]);
    }
    expect(issues({ [field]: 7 })).toEqual([[field, t('rt.issue.addr', { addr: '7' })]]);
  });

  it('streamAddressProblem is the same rule, for the Matching tab to flag as it is typed', () => {
    expect(streamAddressProblem('fe80::/64')).toBeUndefined();
    expect(streamAddressProblem('fe80::/200')).toBe(t('rt.issue.addr', { addr: 'fe80::/200' }));
  });

  it('sni / snis: the host pattern; snis at least one, no repeats; not both', () => {
    expect(issues({ sni: '*' })).toEqual([]);
    expect(issues({ sni: 'bad host' })).toEqual([['sni', t('rt.issue.host', { host: 'bad host' })]]);
    expect(issues({ snis: ['a.example', 'bad host'] })).toEqual([['snis.1', t('rt.issue.host', { host: 'bad host' })]]);
    expect(issues({ snis: ['a.example', 'a.example'] })).toEqual([['snis.1', t('rt.issue.twice', { value: 'a.example' })]]);
    expect(issues({ snis: [] })).toEqual([['snis', t('sr.issue.snisEmpty')]]);
    expect(issues({ sni: 'a.example', snis: ['b.example'] })).toEqual([['snis', t('rt.issue.both', { single: 'sni', plural: 'snis' })]]);
  });

  it('label values: non-empty, no spaces', () => {
    expect(paths({ labels: { env: 'a b' } })).toEqual(['labels']);
  });

  it('a service_id or upstream_id that matches nothing, once its list has loaded', () => {
    expect(issues({ service_id: 'gone', upstream_id: 'nope' })).toEqual([
      ['service_id', t('rt.issue.missing.service', { id: 'gone' })],
      ['upstream_id', t('rt.issue.missing.upstream', { id: 'nope' })],
    ]);
    expect(issues({ service_id: 'gone', upstream_id: 'nope' }, { ...env, ctx: ctxOf({ loaded: { services: false, upstreams: false } }) })).toEqual([]);
  });

  it('protocol: a name; conf an object; logger a list of { name, filter, conf } with conf beside a name', () => {
    expect(issues({ protocol: {} })).toEqual([['protocol.name', t('sr.issue.protocolName')]]);
    expect(issues({ protocol: 'redis' })).toEqual([['protocol', t('sr.issue.protocol')]]);
    expect(issues({ protocol: { name: 'redis', conf: [] } })).toEqual([['protocol.conf', t('sr.issue.protocolConf')]]);
    expect(issues({ protocol: { name: 'redis', logger: {} } })).toEqual([['protocol.logger', t('sr.issue.logger')]]);
    expect(issues({ protocol: { name: 'redis', logger: [{ name: 'syslog' }] } })).toEqual([['protocol.logger', t('sr.issue.loggerEntry', { n: 1 })]]);
    expect(issues({ protocol: { name: 'redis', logger: [{ conf: {}, level: 'x' }] } })).toEqual([['protocol.logger', t('sr.issue.loggerEntry', { n: 1 })]]);
    expect(issues({ protocol: { name: 'redis', logger: [{ name: 'syslog', conf: {}, filter: {} }] } })).toEqual([['protocol.logger', t('sr.issue.loggerEntry', { n: 1 })]]);
  });

  it('protocol.superior_id: not itself, one that exists (once loaded), of the same protocol', () => {
    expect(issues({ id: 'sub', protocol: { name: 'redis', superior_id: 'sub' } })).toEqual([['protocol.superior_id', t('sr.issue.superiorSelf')]]);
    expect(issues({ protocol: { name: 'redis', superior_id: 'gone' } })).toEqual([['protocol.superior_id', t('sr.issue.superiorMissing', { id: 'gone' })]]);
    expect(issues({ protocol: { name: 'redis', superior_id: 'gone' } }, { ...env, ctx: ctxOf({ loaded: { streamRoutes: false } }) })).toEqual([]);
    expect(issues({ protocol: { name: 'dubbo', superior_id: 'redis-main' } })).toEqual([['protocol.name', t('sr.issue.superiorProtocol', { name: 'dubbo', superior: 'redis' })]]);
    // A superior without a protocol of its own is not compared (admin/stream_routes.lua).
    expect(issues({ protocol: { name: 'dubbo', superior_id: 'plain' } })).toEqual([]);
  });

  it('the inline upstream is checked by the schema only: check_conf never calls check_upstream_conf', () => {
    expect(issues({ upstream: { type: 'chash', nodes: [{ host: 'a', port: 1, weight: 1 }] } })).toEqual([]);
    expect(issues({ upstream: { nodes: [] } })).toEqual([]);
    expect(paths({ upstream: { nodes: [{ host: 'a', port: 0, weight: 1 }] } })).toEqual(['upstream.nodes.0.port']);
  });

  it('plugins are checked against the stream set, on the Plugins tab', () => {
    expect(paths({ plugins: { cors: {} } })).toEqual(['plugins.cors']);
    const found = streamRouteIssues({ plugins: { 'limit-conn': {} } }, env);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.path.startsWith('plugins.limit-conn') && i.tab === 'plugins')).toBe(true);
    expect(issues({ plugins: { 'limit-conn': { conn: 1, burst: 0, default_conn_delay: 1, key: 'remote_addr' } } })).toEqual([]);
  });
});
