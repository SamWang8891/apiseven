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

// --- Secret references (fix round 1, R1) ---------------------------------------------------------
// APISIX builds every validator with `skip_validation = secret.is_secret_ref` (core/schema.lua
// 37–45), and its jsonschema library calls that hook first in the validator of every schema node,
// before `type` and every other keyword (jsonschema.lua 622–633 in the 3.20 image): a node accepts
// a value when it is a string that starts with "$secret://" (case-sensitive, secret.lua 37) or, upper-
// cased, with "$ENV://" (core/env.lua 30), and the node's `type` is absent or exactly "string"
// (secret.lua 268–281: a list of types is not). A `$ref` node is its target's validator (the library
// resolves it, jsonschema.lua 166–175). So each such node of the compiled copy becomes
// `{ if: <a reference>, then: true, else: <the node> }`: exact by construction, in composites too.
// Errors are mapped back to the node's own path (originalSchemaPath), so for a value that is not a
// reference they are the same texts at the same paths as without the wrapping.

/** Marks a node the wrapping made (Ajv ignores keywords it does not know). */
const WRAPPER = 'x-apiseven-secret-ref';
/** A string APISIX's is_secret_ref takes, as far as the value goes. */
const SECRET_REF: Obj = { type: 'string', pattern: '^(?:\\$secret://|\\$[Ee][Nn][Vv]://)' };

/** Whether APISIX skips this node for a secret reference (type absent or "string"; a `$ref` node is its target). */
const skipsRefs = (node: Obj): boolean => typeof node.$ref !== 'string' && (node.type === undefined || node.type === 'string');

function wrapNode(node: unknown, root: boolean): unknown {
  if (!isObj(node)) return node;
  const out: Obj = {};
  for (const [key, value] of Object.entries(node)) out[key] = mapSubschemas(key, value, (child) => wrapNode(child, false));
  if (!skipsRefs(node)) return out;
  // The root keeps its definitions and its $id beside the wrapper, where a "#/definitions/…" ref
  // looks for them and Ajv registers (and later removes) the id.
  const kept: Obj = {};
  if (root) {
    for (const key of [...DEFINITIONS, '$id']) {
      if (key in out) {
        kept[key] = out[key];
        delete out[key];
      }
    }
  }
  return { ...kept, [WRAPPER]: true, if: SECRET_REF, then: true, else: out };
}

const decode = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/** The value at `segment` of `at`, by its JSON-pointer form, or its URI-decoded one. */
function step(at: unknown, segment: string): unknown {
  const key = decode(segment);
  const pick = (k: string): unknown => (Array.isArray(at) ? (at as unknown[])[Number(k)] : isObj(at) ? at[k] : undefined);
  const found = pick(key);
  if (found !== undefined) return found;
  try {
    return pick(decode(decodeURIComponent(segment)));
  } catch {
    return undefined;
  }
}

/** A local `$ref` of the normalized schema, as a pointer into the wrapped one (an `else` after each wrapped node). */
function wrappedPointer(root: Obj, ref: string): string {
  if (!ref.startsWith('#')) return ref;
  const segments = ref.slice(1).split('/').slice(1);
  const out: string[] = [];
  let at: unknown = root;
  let isNode = true;
  let raw = false;
  for (const [i, segment] of segments.entries()) {
    if (!raw && isNode && isObj(at) && skipsRefs(at) && !(i === 0 && (DEFINITIONS.has(decode(segment)) || decode(segment) === '$id'))) out.push('else');
    out.push(segment);
    if (raw) continue;
    if (isNode) {
      const key = decode(segment);
      const value = isObj(at) ? at[key] : undefined;
      // One sub-schema: the next segment is its keyword; a list or a map: the next one picks a node.
      isNode = ONE.has(key) || (key === 'items' && !Array.isArray(value));
      raw = !isNode && !LIST.has(key) && !MAP.has(key) && key !== 'items';
      at = value;
    } else {
      at = step(at, segment);
      isNode = true;
    }
  }
  return `#${out.map((segment) => `/${segment}`).join('')}`;
}

function rewriteRefs(node: unknown, root: Obj): void {
  if (Array.isArray(node)) node.forEach((child) => rewriteRefs(child, root));
  else if (isObj(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') node[key] = wrappedPointer(root, value);
      else rewriteRefs(value, root);
    }
  }
}

/** The normalized schema with every node APISIX skips for a secret reference made to accept one first. */
export function skippingSecretRefs(schema: Obj): Obj {
  const wrapped = wrapNode(schema, true) as Obj;
  rewriteRefs(wrapped, schema);
  return wrapped;
}

/**
 * An error's schemaPath in the wrapped schema, as the path of the node in the schema it was made
 * from; undefined for a wrapper's own test (its `if`), which is not a check of the schema.
 */
export function originalSchemaPath(wrapped: Obj, schemaPath: string): string | undefined {
  const segments = schemaPath.replace(/^#/, '').split('/').slice(1);
  const out: string[] = [];
  let at: unknown = wrapped;
  for (const segment of segments) {
    if (isObj(at) && at[WRAPPER] === true) {
      if (segment === 'else') {
        at = at.else;
        continue;
      }
      if (segment === 'if' || segment === 'then') return undefined;
    }
    out.push(segment);
    at = step(at, segment);
  }
  return `#${out.map((segment) => `/${segment}`).join('')}`;
}
