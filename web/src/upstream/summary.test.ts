import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { balancingSummary, connectionSummary, healthSummary, nodesSummary, tlsSummary } from './summary';

describe('section summaries', () => {
  it('nodes: the count and the first addresses, or the discovery service', () => {
    expect(nodesSummary({ nodes: [] })).toBe(t('up.sum.noNodes'));
    expect(nodesSummary({ nodes: [{ host: 'a', port: 1, weight: 1 }] })).toBe('1 node: a:1');
    expect(nodesSummary({ nodes: { 'a:1': 1, 'b:2': 1, 'c:3': 1, 'd:4': 1 } })).toBe('4 nodes: a:1, b:2, c:3 +1');
    expect(nodesSummary({ discovery_type: 'consul', service_name: 'web' })).toBe('consul discovery: web');
  });

  it('balancing: the algorithm, its key and slow start', () => {
    expect(balancingSummary({})).toBe('Round robin');
    expect(balancingSummary({ type: 'chash', hash_on: 'header', key: 'X-User' })).toBe('Consistent hash on header X-User');
    expect(balancingSummary({ type: 'chash', key: 'remote_addr' })).toBe('Consistent hash on vars remote_addr');
    expect(balancingSummary({ type: 'roundrobin', warm_up_conf: { slow_start_time_seconds: 30 } })).toBe('Round robin, slow start 30s');
    expect(balancingSummary({ type: 'weird' })).toBe('weird');
  });

  it('health checks: off, or what is probed', () => {
    expect(healthSummary({})).toBe(t('ui.off'));
    expect(healthSummary({ checks: { active: {} } })).toBe('Active: HTTP GET /');
    expect(healthSummary({ checks: { active: { type: 'tcp' }, passive: {} } })).toBe('Active: TCP; passive');
    expect(healthSummary({ checks: { active: { type: 'https', http_method: 'HEAD', http_path: '/ready' } } })).toBe('Active: HTTPS HEAD /ready');
  });

  it('connection: what is set', () => {
    expect(connectionSummary({})).toBe(t('up.sum.defaults'));
    expect(connectionSummary({ scheme: 'https', timeout: { connect: 3, send: 10, read: 10 }, retries: 1, pass_host: 'node' })).toBe(
      'https, timeouts 3/10/10s, 1 retry, pass host: node',
    );
    expect(connectionSummary({ retries: 0, keepalive_pool: { size: 8 } })).toBe('0 retries, keepalive pool');
  });

  it('TLS: the client certificate and verification', () => {
    expect(tlsSummary({})).toBe(t('up.sum.tlsNone'));
    expect(tlsSummary({ tls: { client_cert: 'C', client_key: 'K', verify: true } })).toBe('inline client certificate, verify');
    expect(tlsSummary({ tls: { client_cert_id: 'c1', verify: false, ca_certs: ['A'] } })).toBe("client certificate c1, don't verify, 1 CA certificate");
  });
});
