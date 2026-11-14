#!/usr/bin/env node
// Save the plugin schemas the dev APISIX publishes, as the fixture the schema-form tests run against.
//
//   node dev/dump-schemas.mjs [3.20]    writes web/src/schema-form/fixtures/plugins-<version>.json
//
// The file is { http: Record<name, PluginInfo>, stream: Record<name, PluginInfo> }: the answers to
// GET plugins?all=true and GET plugins?all=true&subsystem=stream, with object keys sorted so a
// regenerated file diffs cleanly (APISIX serialises Lua tables, so its own key order is a hash order).
// Arrays (enum, required, encrypt_fields) keep their order. The version in the file name comes from
// the Server header (major.minor); pass a version as the argument to override it.
//
// Env: APISIX_ADMIN_URL (default http://127.0.0.1:19180), APISIX_ADMIN_KEY (default dev admin key).
// Node 22+, no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_URL = (process.env.APISIX_ADMIN_URL ?? 'http://127.0.0.1:19180').replace(/\/+$/, '');
const ADMIN_KEY = process.env.APISIX_ADMIN_KEY ?? 'apiseven-dev-admin-key';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'schema-form', 'fixtures');

async function get(query) {
  const res = await fetch(`${ADMIN_URL}/apisix/admin/plugins?${query}`, { headers: { 'X-API-KEY': ADMIN_KEY } });
  if (!res.ok) throw new Error(`GET plugins?${query}: HTTP ${res.status} ${await res.text()}`);
  const version = /APISIX\/([\d.]+)/.exec(res.headers.get('server') ?? '')?.[1];
  return { body: await res.json(), version };
}

/** A copy with every object's keys in sorted order (arrays keep theirs). */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

const http = await get('all=true');
const stream = await get('all=true&subsystem=stream');
const version = process.argv[2] ?? (http.version ? http.version.split('.').slice(0, 2).join('.') : undefined);
if (!version) throw new Error('No APISIX version in the Server header; pass it as an argument, e.g. 3.20');

mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `plugins-${version}.json`);
writeFileSync(file, `${JSON.stringify(sorted({ http: http.body, stream: stream.body }), null, 2)}\n`);
console.log(`${file}: ${Object.keys(http.body).length} http plugins, ${Object.keys(stream.body).length} stream plugins`);
