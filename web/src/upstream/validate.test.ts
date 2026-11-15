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

  it('needs nodes or service discovery, not both (the schema\'s oneOf, schema_def.lua 597–600)', () => {
    expect(messageAt({}, 'nodes')).toBe(t('up.issue.noTarget'));
    expect(messageAt({ ...NODES, discovery_type: 'dns', service_name: 'x' }, 'nodes')).toBe(t('up.issue.both'));
    // Both keys present is both, whatever their values (APISIX: "matches both schemas 1 and 2").
    expect(messageAt({ ...NODES, discovery_type: '', service_name: 'x' }, 'nodes')).toBe(t('up.issue.both'));
    expect(paths({ discovery_type: 'dns' })).toEqual(['service_name']);
    expect(paths({ service_name: 'web' })).toEqual(['discovery_type']);
    expect(paths({ discovery_type: 'dns', service_name: '' })).toEqual(['service_name']);
    expect(messageAt({ nodes: 'x' }, 'nodes')).toBe(t('up.issue.nodesType'));
  });

  it('an empty node list, an empty map key and an empty discovery type are what APISIX stores (Ruling 1)', () => {
    expect(upstreamIssues({ nodes: [] })).toEqual([]);
    expect(upstreamIssues({ nodes: {} })).toEqual([]);
    expect(upstreamIssues({ type: 'roundrobin', nodes: [] })).toEqual([]);
    expect(upstreamIssues({ nodes: { ':80': 1, '': 1 } })).toEqual([]);
    expect(upstreamIssues({ discovery_type: '', service_name: 'web' })).toEqual([]);
  });

  it('an empty table is both an array and an object to APISIX: labels [], an active check [] (fix round 1)', () => {
    expect(upstreamIssues({ ...NODES, labels: [], checks: { active: [] } })).toEqual([]);
    expect(upstreamIssues({ ...NODES, checks: { active: [], passive: [] } })).toEqual([]);
    expect(paths({ ...NODES, labels: ['a'] })).toEqual(['labels']);
    expect(paths({ ...NODES, checks: { active: ['x'] } })).toEqual(['checks']);
  });

  it('an array node\'s IPv6 host needs brackets (check_schema, upstream.lua 534–539)', () => {
    expect(upstreamIssues({ nodes: [{ host: '::1', port: 80, weight: 1 }] })).toEqual([{ path: 'nodes.0.host', message: t('up.issue.ipv6Brackets', { host: '::1' }) }]);
    expect(upstreamIssues({ nodes: [{ host: '[::1]', port: 80, weight: 1 }] })).toEqual([]);
    expect(upstreamIssues({ nodes: [{ host: 'api:8080', port: 80, weight: 1 }] })).toEqual([]);
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
  });

  it('checks each map entry on its row: the port (check_upstream_conf), the weight (the schema)', () => {
    expect(upstreamIssues({ nodes: { ':80': 1, 'a:99999': 1, 'b:80': -2, 'c:80': null, '': 1 } })).toEqual([
      { path: 'nodes.1.port', message: t('up.issue.port') },
      { path: 'nodes.2.weight', message: t('up.issue.weight') },
      { path: 'nodes.3.weight', message: t('up.issue.weightMissing') },
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
    // A key that is there but empty: "missing key" only checks presence; the patterns refuse it, vars_combinations takes any text.
    expect(messageAt({ ...NODES, type: 'chash', key: '' }, 'key')).toBe(t('up.issue.keyVars'));
    expect(messageAt({ ...NODES, type: 'chash', hash_on: 'cookie', key: '' }, 'key')).toBe(t('up.issue.keyName'));
    expect(paths({ ...NODES, type: 'chash', hash_on: 'vars_combinations', key: '' })).toEqual([]);
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

// A stream route's check_conf (apisix/admin/stream_routes.lua) runs the schema only, never
// check_upstream_conf: what that adds is not refused there (verified on the dev APISIX 3.20).
describe('upstreamIssues, schema only (a stream route\'s inline upstream)', () => {
  const schemaOnly = (up: Obj) => upstreamIssues(up, 'upstream', { checkConf: false }).map((i) => i.path);

  it('skips what check_upstream_conf / check_warm_up_conf add: the chash key, pass_host rewrite, map ports, ws + CA, slow start\'s fit', () => {
    expect(schemaOnly({ ...NODES, type: 'chash' })).toEqual([]);
    expect(schemaOnly({ ...NODES, type: 'chash', hash_on: 'header', key: 'bad key!' })).toEqual([]);
    expect(schemaOnly({ ...NODES, pass_host: 'rewrite' })).toEqual([]);
    expect(schemaOnly({ nodes: { '127.0.0.1:70000': 1 } })).toEqual([]);
    expect(schemaOnly({ ...NODES, scheme: 'ws', tls: { ca_certs: ['x'.repeat(200)] } })).toEqual([]);
    expect(schemaOnly({ ...NODES, type: 'chash', key: 'remote_addr', warm_up_conf: { slow_start_time_seconds: 10, min_weight_percent: 1, interval: 20 } })).toEqual([]);
  });

  it('skips the empty node list and an empty map key, which the schema takes', () => {
    expect(schemaOnly({ nodes: [] })).toEqual([]);
    expect(schemaOnly({ nodes: {} })).toEqual([]);
    expect(schemaOnly({ nodes: { '': 1 } })).toEqual([]);
  });

  it('keeps what the schema refuses: no target, both, node fields, timeouts, TLS halves, health check ranges, slow start\'s required fields, labels', () => {
    expect(schemaOnly({})).toEqual(['upstream.nodes']);
    expect(schemaOnly({ ...NODES, discovery_type: 'consul', service_name: 'web' })).toEqual(['upstream.nodes']);
    expect(schemaOnly({ nodes: [{ port: 0, weight: -1 }] })).toEqual(['upstream.nodes.0.host', 'upstream.nodes.0.port', 'upstream.nodes.0.weight']);
    expect(schemaOnly({ nodes: { 'a:80': -1 } })).toEqual(['upstream.nodes.0.weight']);
    expect(schemaOnly({ ...NODES, timeout: { connect: 1 } })).toEqual(['upstream.timeout.send', 'upstream.timeout.read']);
    expect(schemaOnly({ ...NODES, tls: { client_cert: 'c' } })).toEqual(['upstream.tls.client_key']);
    expect(schemaOnly({ ...NODES, retries: -1 })).toEqual(['upstream.retries']);
    expect(schemaOnly({ ...NODES, warm_up_conf: {} })).toEqual(['upstream.warm_up_conf.slow_start_time_seconds', 'upstream.warm_up_conf.min_weight_percent']);
    expect(schemaOnly({ ...NODES, labels: { a: 'b c' } })).toEqual(['upstream.labels']);
  });

  it('the default still checks what check_upstream_conf adds', () => {
    expect(paths({ ...NODES, type: 'chash' })).toEqual(['key']);
    expect(paths({ nodes: { '127.0.0.1:70000': 1 } })).toEqual(['nodes.0.port']);
    expect(paths({ nodes: [{ host: '::1', port: 1, weight: 1 }] })).toEqual(['nodes.0.host']);
  });

  it('the schema only takes an unbracketed IPv6 host (check_schema is check_upstream_conf\'s)', () => {
    expect(schemaOnly({ nodes: [{ host: '::1', port: 1, weight: 1 }] })).toEqual([]);
  });
});

