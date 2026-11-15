import { describe, expect, it } from 'vitest';
import type { Item, Kind, Obj } from '../api/types';
import { RSA_LEAF } from '../test/certs';
import { SEED_CERT } from '../test/sslSeed';
import { entriesOf, search, searchActions, type Action, type Entry } from './search';

const item = (id: string, value: Obj = {}): Item => ({ id, value: { id, ...value } });

/** The ids that `query` finds among `kind`'s items, best first. */
function found(kind: Kind, items: Item[], query: string): string[] {
  return search(entriesOf(kind, items), query).map((hit) => hit.entry.id);
}

describe('entriesOf', () => {
  it('gives one entry per item: its kind, id, title (nameOf, else id) and fields', () => {
    const [named, bare] = entriesOf('routes', [item('r1', { name: 'web', uri: '/a' }), item('r2', { uri: '/b' })]);
    expect(named).toMatchObject({ kind: 'routes', id: 'r1', title: 'web' });
    expect(named?.fields).toEqual(expect.arrayContaining([{ name: 'id', text: 'r1' }, { name: 'name', text: 'web' }, { name: 'uri', text: '/a' }]));
    expect(bare?.title).toBe('r2');
  });

  it('carries the parent of credentials', () => {
    const [entry] = entriesOf('credentials', [item('c1')], { consumer: 'jo' });
    expect(entry).toMatchObject({ kind: 'credentials', id: 'c1', parent: { consumer: 'jo' } });
  });

  it('indexes hostile shapes without throwing', () => {
    const odd: Item[] = [
      item('a', { hosts: 'x', plugins: null, labels: 'l', upstream: { nodes: 5 } }),
      { id: 'b' } as unknown as Item,
      item('c', { uris: [1, null, {}], remote_addrs: {}, snis: 'one', nodes: [null, 3, { host: 7 }] }),
      item('d', { plugins: ['key-auth'], cert: 42, keys: 'k', client: 'x' }),
    ];
    for (const kind of ['routes', 'stream_routes', 'services', 'upstreams', 'ssls', 'consumers', 'secrets', 'plugin_metadata'] as Kind[]) {
      expect(() => entriesOf(kind, odd)).not.toThrow();
      expect(entriesOf(kind, odd).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    }
    expect(() => entriesOf('upstreams', [item('u', { nodes: 5 })])).not.toThrow();
  });
});

describe('finds', () => {
  const routes = [
    item('r1', { name: 'shop', hosts: ['shop.example.com'], uris: ['/cart/*'], plugins: { 'limit-count': {} } }),
    item('r2', { name: 'blog', host: 'blog.example.com', uri: '/posts', labels: { env: 'prod' }, upstream: { nodes: [{ host: '10.1.2.3', port: 8080, weight: 1 }] } }),
    item('r3', { name: 'legacy', uri: '/old', remote_addrs: ['192.168.7.0/24'] }),
  ];

  it('a route by host, by URI, by a plugin name, by a label, by an inline node, by a client address', () => {
    expect(found('routes', routes, 'shop.example')).toEqual(['r1']);
    expect(found('routes', routes, 'blog.example.com')).toEqual(['r2']);
    expect(found('routes', routes, '/cart')).toEqual(['r1']);
    expect(found('routes', routes, '/posts')).toEqual(['r2']);
    expect(found('routes', routes, 'limit-count')).toEqual(['r1']);
    expect(found('routes', routes, 'env:prod')).toEqual(['r2']);
    expect(found('routes', routes, '10.1.2.3:8080')).toEqual(['r2']);
    expect(found('routes', routes, '192.168.7')).toEqual(['r3']);
  });

  it('an SSL by SNI and by a name in its certificate (CN or SAN)', () => {
    const ssls = [item('s1', { snis: ['shop.test', 'www.shop.test'], cert: RSA_LEAF }), item('s2', { sni: 'api.apiseven.test', cert: SEED_CERT })];
    expect(found('ssls', ssls, 'www.shop')).toEqual(['s1']);
    expect(found('ssls', ssls, 'api.apiseven')).toEqual(['s2']);
    // RSA_LEAF's SANs are example.org and *.example.org: neither is an SNI of s1.
    expect(found('ssls', ssls, '*.example.org')).toEqual(['s1']);
    const [hit] = search(entriesOf('ssls', ssls), '*.example.org');
    expect(hit).toMatchObject({ field: 'host', text: '*.example.org' });
  });

  it('an upstream by node address (array or map) and by service name', () => {
    const upstreams = [
      item('u1', { name: 'pool-a', nodes: [{ host: '10.0.0.5', port: 80, weight: 1 }] }),
      item('u2', { name: 'pool-b', nodes: { '10.0.0.6:8443': 1 } }),
      item('u3', { name: 'pool-c', service_name: 'user-svc', discovery_type: 'dns' }),
    ];
    expect(found('upstreams', upstreams, '10.0.0.5:80')).toEqual(['u1']);
    expect(found('upstreams', upstreams, '10.0.0.6')).toEqual(['u2']);
    expect(found('upstreams', upstreams, 'user-svc')).toEqual(['u3']);
  });

  it('a consumer by username, a stream route by server port and address, a service by host', () => {
    expect(found('consumers', [{ id: 'jo', value: { username: 'jo', desc: 'Partner' } }, { id: 'al', value: { username: 'al' } }], 'jo')).toEqual(['jo']);
    const streams = [item('s1', { server_addr: '127.0.0.1', server_port: 9100 }), item('s2', { server_port: 9200, sni: 'mq.example.com' })];
    expect(found('stream_routes', streams, '9100')).toEqual(['s1']);
    expect(found('stream_routes', streams, 'mq.example')).toEqual(['s2']);
    expect(found('services', [item('sv', { hosts: ['svc.example.com'] })], 'svc.example')).toEqual(['sv']);
  });

  it('global rules, plugin configs and consumer groups by plugin name; plugin metadata by its plugin', () => {
    expect(found('global_rules', [item('g1', { plugins: { prometheus: {} } })], 'prometheus')).toEqual(['g1']);
    expect(found('plugin_configs', [item('p1', { plugins: { cors: {} } })], 'cors')).toEqual(['p1']);
    expect(found('consumer_groups', [item('cg', { plugins: { 'limit-req': {} } })], 'limit-req')).toEqual(['cg']);
    expect(found('plugin_metadata', [{ id: 'http-logger', value: { log_format: {} } }], 'http-log')).toEqual(['http-logger']);
  });
});

describe('search', () => {
  it('returns nothing for an empty query', () => {
    expect(search(entriesOf('routes', [item('r1')]), '')).toEqual([]);
    expect(search(entriesOf('routes', [item('r1')]), '   ')).toEqual([]);
  });

  it('is case-insensitive, and every token must match some field (AND)', () => {
    const routes = [
      item('r1', { name: 'API gateway', methods: ['GET'], uri: '/get' }),
      item('r2', { name: 'api admin', uri: '/admin' }),
      item('r3', { name: 'other', uri: '/get' }),
    ];
    // Equal scores: by title.
    expect(found('routes', routes, 'api')).toEqual(['r2', 'r1']);
    expect(found('routes', routes, 'api GET')).toEqual(['r1']);
    expect(found('routes', routes, 'API   admin')).toEqual(['r2']);
    expect(found('routes', routes, 'api nothing')).toEqual([]);
  });

  it('ranks exact id > name prefix > match at a word boundary > any substring', () => {
    const routes = [
      item('r4', { name: 'cobweb' }),
      item('r3', { name: 'my-web' }),
      item('web'),
      item('r2', { name: 'webshop' }),
    ];
    expect(found('routes', routes, 'web')).toEqual(['web', 'r2', 'r3', 'r4']);
  });

  it('a match in the name outranks the same kind of match in another field', () => {
    const routes = [item('r1', { name: 'x', desc: 'web' }), item('r2', { name: 'web' }), item('r3', { name: 'x', uri: '/a/web' }), item('r4', { name: 'a.web' })];
    // r2 exact name, r4 name at a boundary, r1 and r3 at a boundary elsewhere (equal: by title, then id).
    expect(found('routes', routes, 'web')).toEqual(['r2', 'r4', 'r1', 'r3']);
  });

  it('ties: sidebar kind order, then title', () => {
    // Each name holds the `a` inside a word: every hit is the same kind of match.
    const entries = [
      ...entriesOf('upstreams', [item('u', { name: 'delta' })]),
      ...entriesOf('routes', [item('r2', { name: 'zeta' }), item('r1', { name: 'beta' })]),
      ...entriesOf('services', [item('s', { name: 'gamma' })]),
    ];
    expect(search(entries, 'a').map((h) => `${h.entry.kind}:${h.entry.title}`)).toEqual(['routes:beta', 'routes:zeta', 'services:gamma', 'upstreams:delta']);
  });

  it('a hit names the field that matched best, its original text, and the matched ranges in it', () => {
    const [hit] = search(entriesOf('routes', [item('r1', { name: 'shop', hosts: ['Shop.Example.COM'] })]), 'example com');
    expect(hit).toMatchObject({ field: 'host', text: 'Shop.Example.COM', ranges: [[5, 12], [13, 16]] });
    const [byName] = search(entriesOf('routes', [item('r1', { name: 'Web Shop' })]), 'shop');
    expect(byName).toMatchObject({ field: 'name', text: 'Web Shop', ranges: [[4, 8]] });
  });

  it('searches 5,000 entries in well under a frame (< 100 ms here, for CI)', () => {
    const items = Array.from({ length: 5000 }, (_, i) =>
      item(`route-${i}`, {
        name: `service ${i % 97} endpoint ${i}`,
        hosts: [`h${i}.example.com`, `alt${i % 13}.example.org`],
        uris: [`/api/v${i % 4}/items/${i}`],
        plugins: { 'limit-count': {}, [`p${i % 7}`]: {} },
        labels: { team: `t${i % 11}` },
      }),
    );
    const entries: Entry[] = entriesOf('routes', items);
    search(entries, 'warm');
    for (const query of ['example', 'api v2 items', 'h4999', 'zzz-no-match', 'team:t3 limit']) {
      const start = performance.now();
      search(entries, query);
      expect(performance.now() - start, query).toBeLessThan(100);
    }
  });
});

describe('never indexes a secret', () => {
  const KEY_BLOCK = '-----BEGIN PRIVATE KEY-----\nAAAAblockkeysecret\n-----END PRIVATE KEY-----';
  const cases: { kind: Kind; items: Item[]; secrets: string[]; parent?: { consumer: string } }[] = [
    {
      kind: 'routes',
      items: [
        item('r1', {
          name: 'r',
          plugins: { 'openid-connect': { client_id: 'c', client_secret: 'oidc-s3cret' }, 'custom-thing': { anything: 'route-plugin-value' } },
          upstream: { nodes: [{ host: 'n', port: 1, weight: 1 }], tls: { client_cert: 'c', client_key: 'route-up-client-key' } },
          labels: { token: 'label-t0ken' },
          desc: `see ${KEY_BLOCK}`,
        }),
      ],
      secrets: ['oidc-s3cret', 'route-plugin-value', 'route-up-client-key', 'label-t0ken', 'blockkeysecret'],
    },
    { kind: 'stream_routes', items: [item('s1', { plugins: { 'ip-restriction': { message: 'stream-plugin-value' } } })], secrets: ['stream-plugin-value'] },
    {
      kind: 'services',
      items: [item('sv', { plugins: { 'authz-keycloak': { client_secret: 'svc-s3cret' } }, upstream: { nodes: {}, tls: { client_key: 'svc-up-key' } } })],
      secrets: ['svc-s3cret', 'svc-up-key'],
    },
    { kind: 'upstreams', items: [item('u1', { nodes: [], tls: { client_cert: 'c', client_key: 'ups-client-key' } })], secrets: ['ups-client-key'] },
    {
      kind: 'consumers',
      items: [{ id: 'jo', value: { username: 'jo', plugins: { 'key-auth': { key: 'k-123' }, 'basic-auth': { username: 'jo-basic', password: 'bp-1' }, 'jwt-auth': { key: 'jk-1', secret: 'jwt-s3' } } } }],
      secrets: ['k-123', 'jo-basic', 'bp-1', 'jk-1', 'jwt-s3'],
    },
    { kind: 'credentials', parent: { consumer: 'jo' }, items: [item('c1', { plugins: { 'key-auth': { key: 'cred-k-1' } } })], secrets: ['cred-k-1'] },
    { kind: 'consumer_groups', items: [item('cg', { plugins: { 'limit-count': { count: 1, time_window: 1, redis_password: 'cg-redis-pw' } } })], secrets: ['cg-redis-pw'] },
    {
      kind: 'ssls',
      items: [item('ssl1', { snis: ['a.test'], cert: `${RSA_LEAF}\n${KEY_BLOCK}`, key: 'ssl-key-text', keys: ['ssl-keys-text'], certs: [`${RSA_LEAF}\n${KEY_BLOCK}`] })],
      secrets: ['blockkeysecret', 'ssl-key-text', 'ssl-keys-text'],
    },
    {
      kind: 'secrets',
      items: [
        { id: 'vault/v1', value: { uri: 'https://vault.test', prefix: 'kv', token: 'vault-t0k' } },
        { id: 'aws/a1', value: { access_key_id: 'AKIA-ID-1', secret_access_key: 'aws-sak', session_token: 'aws-st' } },
        { id: 'gcp/g1', value: { auth_config: { client_email: 'e', private_key: 'gcp-pk', project_id: 'p' } } },
        { id: 'other/o1', value: { name: 'unknown-manager-name', desc: 'unknown-manager-desc' } },
      ],
      secrets: ['vault-t0k', 'AKIA-ID-1', 'aws-sak', 'aws-st', 'gcp-pk', 'unknown-manager-name', 'unknown-manager-desc'],
    },
    { kind: 'global_rules', items: [item('g1', { plugins: { 'http-logger': { uri: 'http://log.test', auth_header: 'gr-auth-header' } } })], secrets: ['gr-auth-header', 'log.test'] },
    { kind: 'plugin_configs', items: [item('pc', { plugins: { 'kafka-logger': { brokers: [{ host: 'k', port: 1, sasl_config: { user: 'u', password: 'pc-sasl-pw' } }] } } })], secrets: ['pc-sasl-pw'] },
    { kind: 'plugin_metadata', items: [{ id: 'azure-functions', value: { master_apikey: 'az-master-key', master_clientid: 'az-client' } }], secrets: ['az-master-key', 'az-client'] },
  ];

  for (const { kind, items, secrets, parent } of cases) {
    it(`${kind}: typing a secret finds nothing, and no field holds it`, () => {
      const entries = entriesOf(kind, items, parent);
      expect(entries).toHaveLength(items.length);
      for (const secret of secrets) {
        expect(search(entries, secret), secret).toEqual([]);
        expect(JSON.stringify(entries), secret).not.toContain(secret);
      }
    });
  }
});

describe('searchActions', () => {
  const actions: Action[] = [
    { id: 'go', label: 'Go to Routes', keywords: 'open list', run: () => {} },
    { id: 'new', label: 'New Route', keywords: 'create add', run: () => {} },
    { id: 'dark', label: 'Theme: Dark', keywords: 'appearance mode', run: () => {} },
  ];

  it('matches every token against the label and keywords', () => {
    expect(searchActions(actions, 'new ro').map((a) => a.id)).toEqual(['new']);
    expect(searchActions(actions, 'dark').map((a) => a.id)).toEqual(['dark']);
    expect(searchActions(actions, 'create').map((a) => a.id)).toEqual(['new']);
    expect(searchActions(actions, 'route').map((a) => a.id)).toEqual(['go', 'new']);
    expect(searchActions(actions, '')).toEqual(actions);
  });
});
