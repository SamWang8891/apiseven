// node --test 'dev/*.test.mjs': the Admin API path of a listed object comes from its etcd key whatever the
// instance's etcd prefix (deployment.etcd.prefix), for the seed's reset and the end-to-end cleanup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminPathOfKey } from './adminPath.mjs';

const CASES = [
  // [key, the path the list was read at, the path, what follows the kind]
  ['/apisix/routes/r1', 'routes', 'routes/r1', 'r1'],
  ['/gateway/routes/r1', 'routes', 'routes/r1', 'r1'],
  ['/apisix/secrets/vault/my-id', 'secrets', 'secrets/vault/my-id', 'vault/my-id'],
  ['/gateway/secrets/vault/my-id', 'secrets', 'secrets/vault/my-id', 'vault/my-id'],
  ['/apisix/consumers/jack/credentials/c1', 'consumers/jack/credentials', 'consumers/jack/credentials/c1', 'c1'],
  ['/gateway/consumers/jack/credentials/c1', 'consumers/jack/credentials', 'consumers/jack/credentials/c1', 'c1'],
  ['/gateway/consumers/jack', 'consumers', 'consumers/jack', 'jack'],
  ['/a/b/apisix/stream_routes/1', 'stream_routes', 'stream_routes/1', '1'],
  ['/apisix/plugin_metadata/http-logger', 'plugin_metadata', 'plugin_metadata/http-logger', 'http-logger'],
  // A prefix that holds a kind's own name, and an id equal to it.
  ['/routes/x/routes/r1', 'routes', 'routes/r1', 'r1'],
  ['/apisix/routes/routes', 'routes', 'routes/routes', 'routes'],
  // Each part is encoded for the path.
  ['/apisix/consumers/jo e/credentials/c 1', 'consumers/jo e/credentials', 'consumers/jo%20e/credentials/c%201', 'c 1'],
];

for (const [key, listed, path, rest] of CASES) {
  test(`${key} listed at ${listed}`, () => {
    assert.deepEqual(adminPathOfKey(key, listed), { path, rest });
  });
}

test('a key that is not under the path it was listed at is refused, never guessed', () => {
  assert.throws(() => adminPathOfKey('/gateway/upstreams/u1', 'routes'), /not under routes/);
});
