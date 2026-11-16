/** See adminPath.mjs: the Admin API path of a listed object from its etcd key, whatever the etcd prefix. */
export function adminPathOfKey(key: string, listed: string): { path: string; rest: string };
