/// <reference types="node" />
// The plugin schemas of APISIX 3.20 (dev/dump-schemas.mjs), for tests. Read from disk rather than
// imported, so TypeScript does not infer a type for half a megabyte of JSON.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Obj, PluginInfo } from '../api/types';

export interface PluginFixture {
  http: Record<string, PluginInfo>;
  stream: Record<string, PluginInfo>;
}

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema-form', 'fixtures', 'plugins-3.20.json');

let cached: PluginFixture | undefined;

/** The fixture, parsed once per test file. */
export function pluginFixture(): PluginFixture {
  cached ??= JSON.parse(readFileSync(FILE, 'utf8')) as PluginFixture;
  return cached;
}

export const SCHEMA_KINDS = ['schema', 'consumer_schema', 'metadata_schema'] as const;
export type SchemaKind = (typeof SCHEMA_KINDS)[number];

/** Every schema in the fixture: http and stream, each plugin's schema, consumer_schema and metadata_schema. */
export function everySchema(): { subsystem: 'http' | 'stream'; plugin: string; kind: SchemaKind; schema: Obj; label: string }[] {
  const out: ReturnType<typeof everySchema> = [];
  const fixture = pluginFixture();
  for (const subsystem of ['http', 'stream'] as const) {
    for (const [plugin, info] of Object.entries(fixture[subsystem])) {
      for (const kind of SCHEMA_KINDS) {
        const schema = info[kind];
        if (schema) out.push({ subsystem, plugin, kind, schema, label: `${subsystem}:${plugin}:${kind}` });
      }
    }
  }
  return out;
}

/** One plugin's schema of the given kind (http unless asked); throws when the fixture lacks it. */
export function schemaOf(plugin: string, kind: SchemaKind = 'schema', subsystem: 'http' | 'stream' = 'http'): Obj {
  const schema = pluginFixture()[subsystem][plugin]?.[kind];
  if (!schema) throw new Error(`no ${kind} for ${subsystem}:${plugin} in the fixture`);
  return schema;
}
