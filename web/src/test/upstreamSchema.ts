/// <reference types="node" />
// APISIX 3.20's upstream schema (GET /apisix/admin/schema/upstream, keys sorted), for tests.
// Regenerate against the dev APISIX with:
//   curl -s -H 'X-API-KEY: apiseven-dev-admin-key' http://127.0.0.1:19180/apisix/admin/schema/upstream \
//     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=(v)=>Array.isArray(v)?v.map(o):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,o(v[k])])):v;console.log(JSON.stringify(o(JSON.parse(s)),null,2))})' \
//     > web/src/upstream/fixtures/upstream-schema-3.20.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Obj } from '../api/types';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'upstream', 'fixtures', 'upstream-schema-3.20.json');

let cached: Obj | undefined;

/** The schema, parsed once per test file. */
export function upstreamSchema(): Obj {
  cached ??= JSON.parse(readFileSync(FILE, 'utf8')) as Obj;
  return cached;
}
