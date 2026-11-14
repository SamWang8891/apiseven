#!/usr/bin/env node
// Load sample data into the dev APISIX through the Admin API.
//
//   node dev/seed.mjs            create or overwrite the sample objects (idempotent: fixed IDs + PUT)
//   node dev/seed.mjs --reset    delete every object of every type first, then seed
//
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// Node 22+, no dependencies.

const ADMIN_URL = (process.env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180').replace(/\/+$/, '');
const ADMIN_KEY = process.env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key';
const API = `${ADMIN_URL}/apisix/admin`;

// Throwaway self-signed certificate for *.apiseven.test (EC P-256, expires 2036-11-11).
// Dev fixture only; it protects nothing.
const DEV_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUSTUStmCUeAJ3EF9sbzfaXtJswN4wCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNYXBpc2V2ZW4udGVzdDAeFw0yNjExMTQxMTI1NTRaFw0zNjEx
MTExMTI1NTRaMBgxFjAUBgNVBAMMDWFwaXNldmVuLnRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATz930mhXIBbkC5yZAPK3jSdrifXp8BBwSvDZLg3bXnVDH0
6clBbHOb2bwIzdPscHQMxE6DvlFhXR5ahsj7RGbUo34wfDAdBgNVHQ4EFgQUGbgW
mfWOfoZoiyb0jIQWARdcgzwwHwYDVR0jBBgwFoAUGbgWmfWOfoZoiyb0jIQWARdc
gzwwDwYDVR0TAQH/BAUwAwEB/zApBgNVHREEIjAggg1hcGlzZXZlbi50ZXN0gg8q
LmFwaXNldmVuLnRlc3QwCgYIKoZIzj0EAwIDSAAwRQIgZJBayKmadgtwa6rnPb6F
1bXeTNcg1KxFE6YXUqumNjQCIQDUDHfu3SP4BkSZYyD+qgjh7DM6PqEKSC1qviuz
l8/y2Q==
-----END CERTIFICATE-----
`;
const DEV_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg59GD85BzOUzXl7Hu
zyaW6223FzZcl5bo9/2NhQ2GmxOhRANCAATz930mhXIBbkC5yZAPK3jSdrifXp8B
BwSvDZLg3bXnVDH06clBbHOb2bwIzdPscHQMxE6DvlFhXR5ahsj7RGbU
-----END PRIVATE KEY-----
`;

const HELLOWORLD_PROTO = `syntax = "proto3";

package helloworld;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
`;

// [path under /apisix/admin, body], applied in order so references exist before use.
const SEED = [
  ['upstreams/web-pool', {
    name: 'web-pool',
    desc: 'Web frontends',
    type: 'roundrobin',
    nodes: [
      { host: '10.0.0.11', port: 8080, weight: 1 },
      { host: '10.0.0.12', port: 8080, weight: 1 },
    ],
    timeout: { connect: 3, send: 10, read: 10 },
    retries: 1,
  }],
  ['upstreams/api-backend', {
    name: 'api-backend',
    desc: 'Core API, sticky by user',
    type: 'chash',
    hash_on: 'header',
    key: 'x-user-id',
    scheme: 'https',
    pass_host: 'node',
    nodes: [
      { host: 'backend.internal', port: 443, weight: 10 },
      { host: 'backend-2.internal', port: 443, weight: 5 },
    ],
  }],
  ['protos/helloworld', { name: 'helloworld', desc: 'Greeter service', content: HELLOWORLD_PROTO }],
  ['plugin_configs/common-headers', {
    name: 'common-headers',
    desc: 'Response headers shared by storefront routes',
    plugins: { 'response-rewrite': { headers: { set: { 'X-Served-By': 'apisix' } } } },
  }],
  ['consumer_groups/partners', {
    name: 'partners',
    desc: 'External partners',
    labels: { tier: 'partner' },
    plugins: {
      'limit-count': { count: 1000, time_window: 3600, rejected_code: 429, group: 'partners' },
    },
  }],
  ['services/web', {
    name: 'web',
    desc: 'Public website',
    hosts: ['apiseven.test', 'www.apiseven.test'],
    upstream_id: 'web-pool',
    plugins: { gzip: { comp_level: 5 } },
  }],
  ['services/billing', {
    name: 'billing',
    desc: 'Billing service with its own upstream',
    upstream: {
      type: 'roundrobin',
      nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }],
    },
    plugins: { 'limit-req': { rate: 50, burst: 25, key_type: 'var', key: 'remote_addr', rejected_code: 429 } },
  }],
  ['routes/web-home', {
    name: 'web-home',
    desc: 'Website pages; hosts come from the service',
    uri: '/*',
    service_id: 'web',
  }],
  ['routes/api-v1', {
    name: 'api-v1',
    host: 'api.apiseven.test',
    uris: ['/v1', '/v1/*'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    upstream_id: 'api-backend',
    labels: { team: 'core', env: 'dev' },
    plugins: {
      'key-auth': {},
      'limit-count': { count: 100, time_window: 60, rejected_code: 429, key_type: 'var', key: 'remote_addr' },
    },
  }],
  ['routes/api-v2', {
    name: 'api-v2',
    hosts: ['api.apiseven.test', 'api-eu.apiseven.test'],
    uri: '/v2/*',
    priority: 10,
    upstream_id: 'api-backend',
    labels: { team: 'core' },
    plugins: {
      cors: { allow_origins: 'https://www.apiseven.test', allow_methods: 'GET,POST' },
      'proxy-rewrite': { regex_uri: ['^/v2/(.*)', '/$1'] },
    },
  }],
  ['routes/shop', {
    name: 'shop',
    host: 'shop.apiseven.test',
    uri: '/*',
    plugin_config_id: 'common-headers',
    upstream: {
      type: 'roundrobin',
      nodes: [
        { host: '10.0.2.10', port: 8080, weight: 3 },
        { host: '10.0.2.11', port: 8080, weight: 1 },
      ],
    },
  }],
  ['routes/old-wiki', {
    name: 'old-wiki',
    desc: 'Retired; kept for reference',
    host: 'wiki.example.org',
    uri: '/*',
    status: 0,
    upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.20', port: 3000, weight: 1 }] },
  }],
  ['routes/healthz', {
    name: 'healthz',
    desc: 'Answered by APISIX itself',
    uri: '/healthz',
    methods: ['GET'],
    plugins: {
      mocking: { response_status: 200, content_type: 'application/json', response_example: '{"status":"ok"}' },
    },
  }],
  ['routes/admin-panel', {
    name: 'admin-panel',
    hosts: ['admin.apiseven.test'],
    uris: ['/admin', '/admin/*'],
    remote_addrs: ['127.0.0.1', '10.0.0.0/8'],
    upstream_id: 'web-pool',
    plugins: { 'uri-blocker': { block_rules: ['\\.env$', '\\.git/'] } },
  }],
  ['routes/grpc-greeter', {
    name: 'grpc-greeter',
    host: 'grpc.apiseven.test',
    uri: '/hello',
    methods: ['GET'],
    plugins: {
      'grpc-transcode': { proto_id: 'helloworld', service: 'helloworld.Greeter', method: 'SayHello' },
    },
    upstream: { scheme: 'grpc', type: 'roundrobin', nodes: [{ host: '10.0.3.5', port: 50051, weight: 1 }] },
  }],
  ['routes/billing-api', {
    name: 'billing-api',
    host: 'billing.apiseven.test',
    uri: '/billing/*',
    service_id: 'billing',
    vars: [['http_x_tenant', '~~', '^[a-z0-9-]+$']],
    enable_websocket: false,
  }],
  ['routes/static-assets', {
    name: 'static-assets',
    host: '*.apiseven.test',
    uri: '/static/*',
    upstream_id: 'web-pool',
    timeout: { connect: 2, send: 5, read: 5 },
  }],
  ['consumers', { username: 'alice', desc: 'Partner integration', group_id: 'partners', labels: { org: 'acme' } }],
  ['consumers', { username: 'bob', desc: 'Internal tooling' }],
  ['consumers/alice/credentials/alice-key', { name: 'alice-key', plugins: { 'key-auth': { key: 'alice-dev-key' } } }],
  ['consumers/bob/credentials/bob-key', { name: 'bob-key', plugins: { 'key-auth': { key: 'bob-dev-key' } } }],
  ['ssls/apiseven-test', {
    type: 'server',
    snis: ['apiseven.test', '*.apiseven.test'],
    cert: DEV_CERT,
    key: DEV_KEY,
    labels: { env: 'dev' },
  }],
  ['global_rules/default', {
    plugins: { 'request-id': { header_name: 'X-Request-Id', include_in_response: true } },
  }],
  ['stream_routes/etcd-tcp', {
    name: 'etcd-tcp',
    desc: 'TCP 9100 to the dev etcd (try: curl 127.0.0.1:9100/version)',
    server_port: 9100,
    plugins: { 'limit-conn': { conn: 100, burst: 50, default_conn_delay: 0.1, key: 'remote_addr' } },
    upstream: { type: 'roundrobin', nodes: [{ host: 'etcd', port: 2379, weight: 1 }] },
  }],
];

// Deletion order for --reset: referrers before the objects they reference.
// Deleting a consumer also deletes its credentials.
const RESET_ORDER = [
  'global_rules', 'stream_routes', 'routes', 'services', 'plugin_configs', 'consumers',
  'consumer_groups', 'upstreams', 'ssls', 'protos', 'secrets', 'plugin_metadata',
];

// Types counted in the summary line.
const SUMMARY_TYPES = [
  'routes', 'upstreams', 'services', 'consumers', 'consumer_groups', 'ssls', 'global_rules',
  'plugin_configs', 'protos', 'stream_routes',
];

async function admin(method, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { 'X-API-KEY': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${API}/${path}: HTTP ${res.status}, not JSON (is this APISIX?): ${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${API}/${path}: HTTP ${res.status}: ${json.error_msg ?? text}`);
  }
  return json;
}

// Fails unless the URL answers like the APISIX Admin API, so a stray listener on the port is caught.
async function checkAdminApi() {
  let body;
  try {
    body = await admin('GET', 'routes');
  } catch (err) {
    throw new Error(`Admin API check failed at ${ADMIN_URL}: ${err.cause?.message ?? err.message}`);
  }
  if (typeof body.total !== 'number' || !Array.isArray(body.list)) {
    throw new Error(`Admin API check failed at ${ADMIN_URL}: unexpected body ${JSON.stringify(body).slice(0, 120)}`);
  }
}

async function list(type) {
  const body = await admin('GET', type);
  return body.list ?? [];
}

async function reset() {
  for (const type of RESET_ORDER) {
    const items = await list(type);
    for (const item of items) {
      // item.key is the etcd key, e.g. /apisix/routes/1 or /apisix/secrets/vault/my-id.
      const path = item.key.replace(/^\/apisix\//, '').split('/').map(encodeURIComponent).join('/');
      await admin('DELETE', `${path}?force=true`);
    }
    if (items.length > 0) console.log(`deleted ${items.length} ${type}`);
  }
}

async function seed() {
  for (const [path, body] of SEED) {
    await admin('PUT', path, body);
  }
}

async function summary() {
  const parts = [];
  for (const type of SUMMARY_TYPES) {
    parts.push(`${type}=${(await admin('GET', type)).total}`);
  }
  return parts.join(' ');
}

async function main() {
  await checkAdminApi();
  if (process.argv.includes('--reset')) await reset();
  await seed();
  console.log(`seeded ${ADMIN_URL}: ${await summary()}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
