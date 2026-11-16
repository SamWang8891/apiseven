// The Admin API path of an object a list returned, from its etcd key, whatever the instance's etcd
// prefix (deployment.etcd.prefix; /apisix by default, any path otherwise): the path the list was read
// at, then what follows it in the key. Shared by the end-to-end suite (admin.ts, typed by
// adminPath.d.mts) and dev/seed.mjs; tested by dev/adminPath.test.mjs (node --test 'dev/*.test.mjs').
// It sits here, not in dev/, because the image's build type-checks the suite and has no dev/.

/**
 * @param {string} key the object's etcd key: /apisix/routes/r1, /gateway/secrets/vault/my-id,
 *   /apisix/consumers/jack/credentials/c1
 * @param {string} listed the path the list was read at, unencoded: routes, secrets, consumers/jack/credentials
 * @returns {{ path: string, rest: string }} the path, each part encoded (secrets/vault/my-id), and
 *   what follows the listed path in the key (vault/my-id)
 */
export function adminPathOfKey(key, listed) {
  const marker = `/${listed}/`;
  // The last match: a prefix may itself hold a kind's name (/routes/x/routes/r1); what follows the
  // kind (an id, a secret's manager and id) holds no further "/<kind>/".
  const at = key.lastIndexOf(marker);
  if (at < 0) throw new Error(`the key ${key} is not under ${listed}`);
  const rest = key.slice(at + marker.length);
  return { path: [...listed.split('/'), ...rest.split('/')].map(encodeURIComponent).join('/'), rest };
}
