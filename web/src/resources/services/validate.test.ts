// What serviceIssues blocks: only what APISIX 3.20 refuses in a service (the `service` schema in
// apisix/schema_def.lua and check_conf in apisix/admin/services.lua).
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import { serviceIssues } from './validate';

const CTX = ctxOf({ upstreams: [itemOf('u1', { name: 'web-pool', nodes: [{ host: 'a', port: 80, weight: 1 }] })] });
const env = { isNew: false, ctx: CTX, plugins: pluginFixture().http };
const issues = (draft: Obj, e = env) => serviceIssues(draft, e).map((i) => [i.path, i.message, i.tab]);
const paths = (draft: Obj, e = env) => serviceIssues(draft, e).map((i) => i.path);

describe('serviceIssues', () => {
  it('a service may have nothing but a name: no upstream, no hosts, no plugins', () => {
    expect(issues({})).toEqual([]);
    expect(issues({ name: 'web' })).toEqual([]);
  });

  it('a sound service of every part has no issue', () => {
    const full: Obj = {
      name: 'web',
      desc: 'Public website',
      labels: { team: 'web' },
      hosts: ['apiseven.test', '*.apiseven.test', '*'],
      enable_websocket: true,
      upstream_id: 'u1',
      plugins: { gzip: { comp_level: 5 } },
      script: 'local _M = {} return _M',
    };
    expect(issues(full)).toEqual([]);
    expect(issues({ upstream: { type: 'roundrobin', nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] } })).toEqual([]);
  });

  it('hosts: the schema pattern, no repeats, at least one, a list', () => {
    expect(issues({ hosts: ['ok.example', 'bad host'] })).toEqual([['hosts.1', t('rt.issue.host', { host: 'bad host' }), undefined]]);
    expect(issues({ hosts: ['a.example', 'a.example'] })).toEqual([['hosts.1', t('rt.issue.twice', { value: 'a.example' }), undefined]]);
    expect(issues({ hosts: [] })).toEqual([['hosts', t('svc.issue.hostsEmpty'), undefined]]);
    expect(issues({ hosts: 'a.example' })).toEqual([['hosts', t('svc.issue.hostsList'), undefined]]);
    expect(issues({ hosts: [7] })).toEqual([['hosts.0', t('rt.issue.host', { host: '7' }), undefined]]);
    // What the schema's host pattern takes, though it is no hostname.
    expect(issues({ hosts: ['[::1]', 'api:8080', '*example.org'] })).toEqual([]);
  });

  it('label values: non-empty, no spaces', () => {
    expect(paths({ labels: { team: 'a b' } })).toEqual(['labels']);
    expect(paths({ labels: { team: '' } })).toEqual(['labels']);
  });

  it('an upstream_id that matches no upstream, once the upstreams have loaded', () => {
    expect(issues({ upstream_id: 'u9' })).toEqual([['upstream_id', t('rt.issue.missing.upstream', { id: 'u9' }), undefined]]);
    expect(issues({ upstream_id: 'u9' }, { ...env, ctx: ctxOf({ loaded: { upstreams: false } }) })).toEqual([]);
  });

  it('an inline upstream with an empty node list is what APISIX stores: no issue (Ruling 1)', () => {
    expect(issues({ upstream: { nodes: [] } })).toEqual([]);
    expect(issues({ upstream: { nodes: {} } })).toEqual([]);
  });

  it('an inline upstream is checked with check_upstream_conf too, its paths under upstream', () => {
    expect(paths({ upstream: { nodes: [{ port: 80, weight: 1 }], type: 'chash' } })).toEqual(['upstream.nodes.0.host', 'upstream.key']);
    expect(paths({ upstream: { nodes: [{ host: 'a', port: 80, weight: 1 }], pass_host: 'rewrite' } })).toEqual(['upstream.upstream_host']);
  });

  it('plugins are checked against the http set, on the Plugins tab', () => {
    const found = serviceIssues({ plugins: { 'limit-count': {} } }, env);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.path.startsWith('plugins.limit-count') && i.tab === 'plugins')).toBe(true);
    expect(paths({ plugins: { 'mqtt-proxy': {} } })).toEqual(['plugins.mqtt-proxy']);
  });
});
