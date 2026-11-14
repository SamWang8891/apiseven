import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { upstreamIssues } from './validate';

const NODES = { nodes: [{ host: 'a', port: 80, weight: 1 }] };
const paths = (up: Obj, prefix?: string) => upstreamIssues(up, prefix).map((i) => i.path);
const messageAt = (up: Obj, path: string) => upstreamIssues(up).find((i) => i.path === path)?.message;

describe('upstreamIssues', () => {
  it('is empty for a sound upstream (map or array nodes, or discovery)', () => {
    expect(upstreamIssues({ type: 'roundrobin', ...NODES })).toEqual([]);
    expect(upstreamIssues({ nodes: { 'a:80': 1, '[::1]:81': 0 } })).toEqual([]);
    expect(upstreamIssues({ discovery_type: 'consul', service_name: 'web' })).toEqual([]);
  });

  it('needs nodes or service discovery, not both', () => {
    expect(messageAt({}, 'nodes')).toBe(t('up.issue.noTarget'));
    expect(messageAt({ nodes: [] }, 'nodes')).toBe(t('up.issue.noNodes'));
    expect(messageAt({ nodes: {} }, 'nodes')).toBe(t('up.issue.noNodes'));
    expect(messageAt({ ...NODES, discovery_type: 'dns', service_name: 'x' }, 'nodes')).toBe(t('up.issue.both'));
    expect(paths({ discovery_type: 'dns' })).toEqual(['service_name']);
    expect(paths({ service_name: 'web' })).toEqual(['discovery_type']);
  });

  it('checks each node: host, port 1–65535, weight ≥ 0, whole numbers', () => {
    const up = { nodes: [{ port: 0, weight: -1 }, { host: 'b', port: 70000, weight: 1.5, priority: 0.5 }, { host: 'c' }] };
    expect(upstreamIssues(up)).toEqual([
      { path: 'nodes.0.host', message: t('up.issue.host') },
      { path: 'nodes.0.port', message: t('up.issue.port') },
      { path: 'nodes.0.weight', message: t('up.issue.weight') },
      { path: 'nodes.1.port', message: t('up.issue.port') },
      { path: 'nodes.1.weight', message: t('up.issue.weight') },
      { path: 'nodes.1.priority', message: t('up.issue.priority') },
      { path: 'nodes.2.weight', message: t('up.issue.weightMissing') },
    ]);
    expect(upstreamIssues({ nodes: { 'a:99999': 1, 'b:80': -2 } })).toEqual([
      { path: 'nodes', message: t('up.issue.mapPort', { addr: 'a:99999' }) },
      { path: 'nodes', message: t('up.issue.mapWeight', { addr: 'b:80' }) },
    ]);
  });

  it('chash needs a key, except when hashing on the consumer; the key fits what it hashes on', () => {
    expect(paths({ ...NODES, type: 'chash' })).toEqual(['key']);
    expect(paths({ ...NODES, type: 'chash', hash_on: 'consumer' })).toEqual([]);
    expect(paths({ ...NODES, type: 'chash', key: 'remote_addr' })).toEqual([]);
    expect(paths({ ...NODES, type: 'chash', key: 'arg_user' })).toEqual([]);
    expect(messageAt({ ...NODES, type: 'chash', key: 'http_x' }, 'key')).toBe(t('up.issue.keyVars'));
    expect(messageAt({ ...NODES, type: 'chash', hash_on: 'header', key: 'X User' }, 'key')).toBe(t('up.issue.keyName'));
    expect(paths({ ...NODES, type: 'chash', hash_on: 'vars_combinations', key: '$remote_addr$uri' })).toEqual([]);
  });

  it('needs all three timeouts, each above 0', () => {
    expect(upstreamIssues({ ...NODES, timeout: { connect: 1, send: 0 } })).toEqual([
      { path: 'timeout.send', message: t('up.issue.positive') },
      { path: 'timeout.read', message: t('up.issue.timeoutAll') },
    ]);
  });

  it('pass_host rewrite needs upstream_host', () => {
    expect(paths({ ...NODES, pass_host: 'rewrite' })).toEqual(['upstream_host']);
    expect(paths({ ...NODES, pass_host: 'rewrite', upstream_host: 'h' })).toEqual([]);
  });

  it('an inline client certificate needs both halves, and not an SSL object too', () => {
    expect(paths({ ...NODES, tls: { client_cert: 'C' } })).toEqual(['tls.client_key']);
    expect(paths({ ...NODES, tls: { client_key: 'K' } })).toEqual(['tls.client_cert']);
    expect(paths({ ...NODES, tls: { client_cert: 'C', client_key: 'K', client_cert_id: '1' } })).toEqual(['tls.client_cert_id']);
    expect(paths({ ...NODES, scheme: 'wss', tls: { ca_certs: ['C'] } })).toEqual(['tls.ca_certs']);
  });

  it('passive checks need active ones; ranges follow the schema', () => {
    expect(messageAt({ ...NODES, checks: { passive: {} } }, 'checks.passive')).toBe(t('up.issue.passiveNeedsActive'));
    expect(paths({ ...NODES, checks: {} })).toEqual(['checks']);
    expect(upstreamIssues({ ...NODES, checks: { active: { port: 0, healthy: { successes: 255, http_statuses: [200, 600] } } } })).toEqual([
      { path: 'checks.active.port', message: t('up.issue.range', { min: 1, max: 65535 }) },
      { path: 'checks.active.healthy.successes', message: t('up.issue.range', { min: 1, max: 254 }) },
      { path: 'checks.active.healthy.http_statuses', message: t('up.issue.statuses') },
    ]);
  });

  it('checks slow start against the algorithm, its interval and the node priorities', () => {
    const warm = { slow_start_time_seconds: 10, min_weight_percent: 50 };
    expect(paths({ ...NODES, warm_up_conf: warm })).toEqual([]);
    expect(paths({ ...NODES, warm_up_conf: {} })).toEqual(['warm_up_conf.slow_start_time_seconds', 'warm_up_conf.min_weight_percent']);
    expect(paths({ ...NODES, type: 'chash', key: 'uri', warm_up_conf: warm })).toEqual(['warm_up_conf']);
    expect(paths({ ...NODES, warm_up_conf: { ...warm, interval: 11 } })).toEqual(['warm_up_conf.interval']);
    expect(paths({ nodes: [{ host: 'a', weight: 1 }, { host: 'b', weight: 1, priority: 1 }], warm_up_conf: warm })).toEqual(['warm_up_conf']);
  });

  it('label values have no spaces', () => {
    expect(paths({ ...NODES, labels: { team: 'a b' } })).toEqual(['labels']);
  });

  it('prefixes every path for an upstream inside another object', () => {
    expect(paths({ nodes: [{ port: 80, weight: 1 }], type: 'chash' }, 'upstream')).toEqual(['upstream.nodes.0.host', 'upstream.key']);
  });
});
