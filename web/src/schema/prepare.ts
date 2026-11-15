// What Ajv compiles for an APISIX schema (ajv.ts validatorFor): a draft-07 copy in which every part the
// browser cannot read is left to APISIX, without ever making the check refuse more than before.
// - Draft-07: no `$schema` (a draft-04 URI would not resolve); draft-04's boolean `exclusiveMinimum`
//   / `exclusiveMaximum` become the draft-07 numbers.
// - Failing open (Task 16 B18, fix round 1 F1): a `pattern` JavaScript cannot compile (Ajv builds
//   `new RegExp(p, 'u')`; APISIX reads patterns as PCRE, openwhisk's `\A…\z`) is left out; so is a
//   `patternProperties` key, with that object's `additionalProperties` (the keys the pattern meant
//   would be refused as additional). Leaving a constraint out only loosens a schema where the
//   constraint counts positively. Under `not`, inside an `if`, or in a `oneOf` branch it can tighten
//   it, so there the outermost such keyword above the unreadable part goes instead (an `if` with its
//   `then` and `else`): the check accepts what that keyword would have decided. An unreadable part in
//   `definitions` (a `$ref` may reach it from any position) leaves the whole schema to APISIX.
// The walk knows which keywords hold sub-schemas, so a property named `not` or `pattern` is a
// property. Pure.
import type { Obj } from '../api/types';
import { compiles, isObj } from './refs';

/** A kind of part left to APISIX: unreadable patterns, the keys they cover, the conditions above them. */
export type SchemaGap = 'patterns' | 'keys' | 'conditions';
/** What a schema's checks leave to APISIX: some kinds of part, or all of it. */
export type SchemaGaps = 'all' | SchemaGap[];

/** Keywords whose value is one sub-schema. */
const ONE = new Set(['not', 'if', 'then', 'else', 'additionalProperties', 'additionalItems', 'contains', 'propertyNames']);
/** Keywords whose value is a list of sub-schemas. */
const LIST = new Set(['allOf', 'anyOf', 'oneOf']);
/** Keywords whose value maps names to sub-schemas (a `dependencies` list of names stays as it is). */
const MAP = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas']);
/** Keywords where leaving a constraint out of a sub-schema can make the whole check stricter. */
const NON_MONOTONE = new Set(['not', 'if', 'oneOf']);
const DEFINITIONS = new Set(['definitions', '$defs']);

/**
 * `value` (the value of `key` in a schema node) with `fn` applied to each sub-schema it holds;
 * values that hold none (enum, required, type, keywords Ajv does not know) as they are.
 */
export function mapSubschemas(key: string, value: unknown, fn: (child: unknown, path: string[]) => unknown): unknown {
  if (ONE.has(key)) return fn(value, []);
  if (LIST.has(key)) return Array.isArray(value) ? value.map((child, i) => fn(child, [String(i)])) : value;
  if (key === 'items') return Array.isArray(value) ? value.map((child, i) => fn(child, [String(i)])) : fn(value, []);
  if (MAP.has(key) && isObj(value)) return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, Array.isArray(child) ? child : fn(child, [name])]));
  return value;
}

interface Found {
  patterns: boolean;
  keys: boolean;
  conditions: boolean;
  all: boolean;
}

/** The outermost non-monotone keyword above the part being walked: hit when an unreadable part is below it. */
interface Guard {
  hit: boolean;
}

function normalizeNode(node: unknown, found: Found, guard: Guard | undefined, inDefinitions: boolean): unknown {
  if (!isObj(node)) return node;
  const unreadable = (kind: 'patterns' | 'keys') => {
    if (inDefinitions) found.all = true;
    else if (guard) guard.hit = true;
    else found[kind] = true;
  };
  const out: Obj = {};
  let unreadKeys = false;
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (key === 'pattern' && typeof value === 'string' && !compiles(value)) {
      unreadable('patterns');
      continue;
    }
    if (key === 'patternProperties' && isObj(value)) {
      const kept: Obj = {};
      for (const [pattern, child] of Object.entries(value)) {
        if (compiles(pattern)) kept[pattern] = normalizeNode(child, found, guard, inDefinitions);
        else {
          unreadable('keys');
          unreadKeys = true;
        }
      }
      out[key] = kept;
      continue;
    }
    // This node holds the outermost non-monotone keyword on its path: it owns the guard below it.
    const own = NON_MONOTONE.has(key) && !guard && !inDefinitions ? { hit: false } : undefined;
    const below = own ?? guard;
    const definitions = inDefinitions || DEFINITIONS.has(key);
    out[key] = mapSubschemas(key, value, (child) => normalizeNode(child, found, below, definitions));
    if (own?.hit) dropped.push(key);
  }
  if (unreadKeys) delete out.additionalProperties;
  for (const key of dropped) {
    delete out[key];
    if (key === 'if') {
      delete out.then;
      delete out.else;
    }
    found.conditions = true;
  }
  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof out[flag] !== 'boolean') continue;
    if (out[flag] && typeof out[bound] === 'number') {
      out[flag] = out[bound];
      delete out[bound];
    } else {
      delete out[flag];
    }
  }
  return out;
}

/** The copy Ajv compiles, and what it leaves to APISIX ('all': do not compile it; [] when nothing). */
export function normalize(schema: Obj): { schema: Obj; gaps: SchemaGaps } {
  const found: Found = { patterns: false, keys: false, conditions: false, all: false };
  const copy = normalizeNode(schema, found, undefined, false) as Obj;
  if (found.all) return { schema: copy, gaps: 'all' };
  return { schema: copy, gaps: (['patterns', 'keys', 'conditions'] as const).filter((gap) => found[gap]) };
}
