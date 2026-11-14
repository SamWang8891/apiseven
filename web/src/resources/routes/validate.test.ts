import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { issuesByTab } from '../../editor/issues';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import type { ValidateEnv } from '../registry';
import { addrProblem, hostProblem, routeIssues, uriProblem } from './validate';

const env = (over: Partial<ValidateEnv> = {}): ValidateEnv => ({ isNew: false, ctx: ctxOf(), ...over });
/** A route with something to do, so only the issue under test shows. */
const ok: Obj = { uri: '/a', upstream_id: 'u1' };
const withCtx = env({ ctx: ctxOf({ upstreams: [itemOf('u1')], services: [itemOf('s1')], pluginConfigs: [itemOf('pc1')] }) });
const issues = (draft: Obj, e: ValidateEnv = withCtx) => routeIssues(draft, e).map(({ path, message }) => ({ path, message }));

/** The tabs as the registry defines them, for attribution. */
const TABS = [
  { id: 'general', fields: ['name', 'desc', 'labels', 'priority'] },
  { id: 'matching', fields: ['host', 'hosts', 'uri', 'uris', 'methods', 'remote_addr', 'remote_addrs', 'vars', 'filter_func'] },
  { id: 'upstream', fields: ['service_id', 'upstream_id', 'upstream'] },
  { id: 'plugins', fields: ['plugins', 'plugin_config_id'] },
  { id: 'advanced', fields: ['timeout', 'enable_websocket', 'script', 'script_id'] },
];

describe('routeIssues', () => {
  it('a complete route has none', () => {
    expect(issues(ok)).toEqual([]);
    expect(issues({ uris: ['/a', '/b/*'], hosts: ['a.example', '*.b.example'], remote_addrs: ['10.0.0.1', '10.0.0.0/8', '::1', 'fe80::/10'], service_id: 's1', methods: ['GET', 'PURGE'], priority: 3 })).toEqual([]);
  });

  describe('URIs', () => {
    it('at least one', () => {
      expect(issues({ upstream_id: 'u1' })).toEqual([{ path: 'uri', message: t('rt.issue.noUri') }]);
      expect(issues({ upstream_id: 'u1', uris: [] })).toEqual([{ path: 'uri', message: t('rt.issue.noUri') }]);
    });

    it('a URI not starting with / is APISIX\'s to take: no issue (the URIs box refuses it as it is typed)', () => {
      expect(issues({ ...ok, uri: 'a/*' })).toEqual([]);
      expect(issues({ upstream_id: 'u1', uris: ['/a', 'b'] })).toEqual([]);
    });

    it('uri is at most 4096 characters; the schema sets no length for uris items', () => {
      const long = `/${'a'.repeat(4096)}`;
      expect(issues({ upstream_id: 'u1', uri: long })).toEqual([{ path: 'uri', message: t('rt.issue.uriLong') }]);
      expect(issues({ upstream_id: 'u1', uris: ['/a', long] })).toEqual([]);
    });

    it('uris has no repeats', () => {
      expect(issues({ upstream_id: 'u1', uris: ['/a', '/a'] })).toEqual([{ path: 'uris.1', message: t('rt.issue.twice', { value: '/a' }) }]);
    });

    it('uri and uris together, as APISIX refuses them', () => {
      expect(issues({ ...ok, uris: ['/b', '/c'] })).toEqual([{ path: 'uris', message: t('rt.issue.both', { single: 'uri', plural: 'uris' }) }]);
    });
  });

  describe('hosts and addresses', () => {
    it('host syntax: the schema pattern', () => {
      expect(issues({ ...ok, host: 'a b' })).toEqual([{ path: 'host', message: t('rt.issue.host', { host: 'a b' }) }]);
      expect(issues({ ...ok, hosts: ['ok.example', 'a/b'] })).toEqual([{ path: 'hosts.1', message: t('rt.issue.host', { host: 'a/b' }) }]);
      expect(issues({ ...ok, host: 'a', hosts: ['b'] })).toEqual([{ path: 'hosts', message: t('rt.issue.both', { single: 'host', plural: 'hosts' }) }]);
    });

    it('address syntax: exactly the schema (ip_def: inet_pton for the addresses, its patterns for CIDR)', () => {
      expect(issues({ ...ok, remote_addr: '10.0.0.256' })).toEqual([{ path: 'remote_addr', message: t('rt.issue.addr', { addr: '10.0.0.256' }) }]);
      expect(issues({ ...ok, remote_addrs: ['10.0.0.0/33', 'fe80::1'] })).toEqual([{ path: 'remote_addrs.0', message: t('rt.issue.addr', { addr: '10.0.0.0/33' }) }]);
      // The schema's IPv6/CIDR pattern takes any 1–3 digit prefix; only the box refuses /200 as it is typed.
      for (const accepted of ['fe80::/200', '::/0', '2001:db8::/32', '10.0.0.0/8', '0.0.0.0/0', '::ffff:10.0.0.1']) {
        expect(issues({ ...ok, remote_addr: accepted }), accepted).toEqual([]);
      }
      // The IPv4/CIDR pattern has no leading zeros in the prefix; inet_pton takes no zone id.
      for (const refused of ['10.0.0.0/05', '01.2.3.4', 'fe80::1%eth0', '10.0.0.1/']) {
        expect(issues({ ...ok, remote_addr: refused }), refused).toEqual([{ path: 'remote_addr', message: t('rt.issue.addr', { addr: refused }) }]);
      }
    });

    it('a value listed twice', () => {
      expect(issues({ ...ok, hosts: ['a', 'a'] })).toEqual([{ path: 'hosts.1', message: t('rt.issue.twice', { value: 'a' }) }]);
    });
  });

  it('methods APISIX does not know, or listed twice', () => {
    expect(issues({ ...ok, methods: ['GET', 'get'] })).toEqual([{ path: 'methods', message: t('rt.issue.method', { method: 'get' }) }]);
    expect(issues({ ...ok, methods: ['GET', 'GET'] })).toEqual([{ path: 'methods', message: t('rt.issue.twice', { value: 'GET' }) }]);
  });

  it('priority is a whole number', () => {
    expect(issues({ ...ok, priority: 1.5 })).toEqual([{ path: 'priority', message: t('rt.issue.priority') }]);
  });

  it('timeout needs all three, each above 0', () => {
    expect(issues({ ...ok, timeout: { connect: 3 } })).toEqual([
      { path: 'timeout.send', message: t('rt.issue.timeoutAll') },
      { path: 'timeout.read', message: t('rt.issue.timeoutAll') },
    ]);
    expect(issues({ ...ok, timeout: { connect: 0, send: 1, read: 1 } })).toEqual([{ path: 'timeout.connect', message: t('rt.issue.positive') }]);
  });

  describe('something to do (the schema anyOf: plugins, upstream, upstream_id, service_id or script)', () => {
    const nothing = [{ path: '', message: t('rt.issue.nothing') }];
    it('flags a route with none of them, on the Upstream tab', () => {
      expect(issues({ uri: '/a' })).toEqual(nothing);
      expect(issuesByTab(routeIssues({ uri: '/a' }, withCtx), TABS, 'json').get('upstream')).toHaveLength(1);
    });

    it('a plugin config alone is not enough, as APISIX says', () => {
      expect(issues({ uri: '/a', plugin_config_id: 'pc1' })).toEqual(nothing);
    });

    it.each([
      ['plugins', { plugins: {} }],
      ['an inline upstream', { upstream: { nodes: [{ host: 'h', port: 80, weight: 1 }] } }],
      ['upstream_id', { upstream_id: 'u1' }],
      ['service_id', { service_id: 's1' }],
      ['a script', { script: 'return { access = function() end }' }],
    ])('is satisfied by %s', (_, part) => {
      expect(issues({ uri: '/a', ...part })).toEqual([]);
    });
  });

  it('a script excludes plugins and a plugin config', () => {
    const script = 'return { access = function() end }';
    expect(issues({ uri: '/a', script, plugins: {} })).toEqual([{ path: 'script', message: t('rt.issue.scriptWithPlugins') }]);
    expect(issues({ uri: '/a', script, plugin_config_id: 'pc1' })).toEqual([{ path: 'script', message: t('rt.issue.scriptWithPlugins') }]);
    expect(issues({ uri: '/a', script: 'short' })).toEqual([{ path: 'script', message: t('rt.issue.scriptLength') }]);
  });

  it('filter_func is a Lua function', () => {
    expect(issues({ ...ok, filter_func: 'return true' })).toEqual([{ path: 'filter_func', message: t('rt.issue.filterFunc') }]);
    expect(issues({ ...ok, filter_func: 'function(vars) return true end' })).toEqual([]);
  });

  it('vars is a list', () => {
    expect(issues({ ...ok, vars: { a: 1 } })).toEqual([{ path: 'vars', message: t('rt.issue.vars') }]);
  });

  it('label values: no spaces, not empty', () => {
    expect(issues({ ...ok, labels: { team: 'a b' } })).toEqual([{ path: 'labels', message: t('rt.issue.labels') }]);
  });

  describe('references to objects that do not exist', () => {
    it('flags each once its list has loaded', () => {
      expect(issues({ uri: '/a', upstream_id: 'gone', service_id: 'nope', plugin_config_id: 'none' })).toEqual([
        { path: 'service_id', message: t('rt.issue.missing.service', { id: 'nope' }) },
        { path: 'upstream_id', message: t('rt.issue.missing.upstream', { id: 'gone' }) },
        { path: 'plugin_config_id', message: t('rt.issue.missing.pluginConfig', { id: 'none' }) },
      ]);
    });

    it('not while the list is loading', () => {
      const loading = env({ ctx: ctxOf({ loaded: { upstreams: false, services: false, pluginConfigs: false } }) });
      expect(issues({ uri: '/a', upstream_id: 'gone', service_id: 'nope', plugin_config_id: 'none' }, loading)).toEqual([]);
      // An empty list that has loaded is a list without it.
      expect(issues({ uri: '/a', upstream_id: 'gone' }, env())).toEqual([{ path: 'upstream_id', message: t('rt.issue.missing.upstream', { id: 'gone' }) }]);
    });

    it('a number id matches its object', () => {
      const e = env({ ctx: ctxOf({ upstreams: [itemOf('7')] }) });
      expect(issues({ uri: '/a', upstream_id: 7 }, e)).toEqual([]);
    });
  });

  it('checks an inline upstream, its paths prefixed upstream. and its issues on the Upstream tab', () => {
    const draft = { uri: '/a', upstream: { type: 'chash', nodes: [{ port: 80, weight: 1 }] } };
    const found = routeIssues(draft, withCtx);
    expect(found.map((i) => i.path)).toEqual(['upstream.nodes.0.host', 'upstream.key']);
    expect([...issuesByTab(found, TABS, 'json').keys()]).toEqual(['upstream']);
  });

  it('attributes plugin issues to the Plugins tab', () => {
    const plugins = pluginFixture().http;
    const draft = { uri: '/a', plugins: { 'limit-count': { count: 'x' } } };
    const found = routeIssues(draft, env({ plugins }));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.path.startsWith('plugins.limit-count'))).toBe(true);
    expect([...issuesByTab(found, TABS, 'json').keys()]).toEqual(['plugins']);
  });
});

describe('field checks the Matching tab uses', () => {
  it('hostProblem follows the schema pattern', () => {
    for (const ok of ['example.org', '*.example.org', '*', 'a-b_c.d', '[::1]', 'api:8080', '*example.org']) expect(hostProblem(ok), ok).toBeUndefined();
    for (const bad of ['a b', 'a/b', '**.a', 'a.*', 'ä.example', '']) expect(hostProblem(bad), bad).toBeDefined();
  });

  it('uriProblem (as typed): starts with /, at most 4096 characters', () => {
    expect(uriProblem('/a/*')).toBeUndefined();
    expect(uriProblem('a')).toBe(t('rt.issue.uriSlash', { uri: 'a' }));
    expect(uriProblem(`/${'a'.repeat(4096)}`)).toBe(t('rt.issue.uriLong'));
  });

  it('addrProblem (as typed): IPv4, IPv6 and CIDR, an IPv6 prefix of at most 128', () => {
    for (const ok of ['1.2.3.4', '10.0.0.0/8', '0.0.0.0/0', '::', '::1', 'fe80::1', '2001:db8::/32', '::ffff:10.0.0.1', '1:2:3:4:5:6:7:8']) expect(addrProblem(ok), ok).toBeUndefined();
    for (const bad of ['1.2.3', '256.1.1.1', '01.2.3.4x', '10.0.0.0/33', '10.0.0.0/05', 'fe80::/200', 'a.b.c.d', '1:2:3:4:5:6:7:8:9', ':::1', 'fe80::1::2', 'host']) expect(addrProblem(bad), bad).toBeDefined();
  });
});
