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
//   `definitions` (a `$ref` may reach it from any position) leaves the whole schema to APISIX, and so
//   does any unreadable part in a schema with a `$ref` that points elsewhere (`#`, `#/properties/a`),
//   since such a ref may reach the part from under a `not` (fix round 2, R12.3).
// - Formats: Ajv here checks none (ajv.ts validateFormats: false), so a `format` is left to APISIX
//   the same way, and named in the note (Task 16b, item 153).
// The walk knows which keywords hold sub-schemas, so a property named `not` or `pattern` is a
// property. Pure.
import type { Obj } from '../api/types';
import { compiles, isObj, resolveRef } from './refs';

/** A kind of part left to APISIX: unreadable patterns, the keys they cover, the conditions above them, formats. */
export type SchemaGap = 'patterns' | 'keys' | 'conditions' | 'formats';
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
  formats: boolean;
  /** The formats left to APISIX, by name. */
  formatNames: Set<string>;
  all: boolean;
  /** A `$ref` points somewhere other than `definitions` / `$defs`. */
  refElsewhere: boolean;
}

const INTO_DEFINITIONS = /^#\/(?:definitions|\$defs)\//;

/** The outermost non-monotone keyword above the part being walked: hit when an unreadable part is below it. */
interface Guard {
  hit: boolean;
}

function normalizeNode(node: unknown, found: Found, guard: Guard | undefined, inDefinitions: boolean): unknown {
  if (!isObj(node)) return node;
  const unreadable = (kind: 'patterns' | 'keys' | 'formats') => {
    if (inDefinitions) found.all = true;
    else if (guard) guard.hit = true;
    else found[kind] = true;
  };
  const out: Obj = {};
  let unreadKeys = false;
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (key === '$ref' && typeof value === 'string' && !INTO_DEFINITIONS.test(value)) found.refElsewhere = true;
    if (key === 'pattern' && typeof value === 'string' && !compiles(value)) {
      unreadable('patterns');
      continue;
    }
    if (key === 'format' && typeof value === 'string') {
      // Skipped wherever it is (under a condition too, which then goes as well): the note names it.
      found.formatNames.add(value);
      found.formats = true;
      unreadable('formats');
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

/** The copy Ajv compiles, and what it leaves to APISIX ('all': do not compile it; [] when nothing), with the formats by name. */
export function normalize(schema: Obj): { schema: Obj; gaps: SchemaGaps; formats: string[] } {
  const found: Found = { patterns: false, keys: false, conditions: false, formats: false, formatNames: new Set(), all: false, refElsewhere: false };
  const copy = normalizeNode(schema, found, undefined, false) as Obj;
  const formats = [...found.formatNames].sort();
  if (found.all || (found.refElsewhere && (found.patterns || found.keys || found.conditions || found.formats))) return { schema: copy, gaps: 'all', formats };
  return { schema: copy, gaps: (['patterns', 'keys', 'conditions', 'formats'] as const).filter((gap) => found[gap]), formats };
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

/**
 * Points every `$ref` of the wrapped schema into it. Only schema nodes are walked (mapSubschemas'
 * positions): literal data (`enum`, `const`, `default`, `examples`) may hold a "$ref" key that is a
 * value, and is shared with the schema APISIX published, which is never written to (Task 16b, item
 * 148). The nodes walked are the wrapping's own copies (wrapNode), so writing to them is safe.
 */
function rewriteRefs(node: unknown, root: Obj): void {
  if (!isObj(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') node[key] = wrappedPointer(root, value);
    else
      mapSubschemas(key, value, (child) => {
        rewriteRefs(child, root);
        return child;
      });
  }
}

/** The normalized schema with every node APISIX skips for a secret reference made to accept one first. */
export function skippingSecretRefs(schema: Obj): Obj {
  const wrapped = wrapNode(schema, true) as Obj;
  rewriteRefs(wrapped, schema);
  return wrapped;
}

/**
 * The objects the wrapped schema's local `$ref`s point at, besides its root: Ajv compiles a recursive
 * target as a function of its own and reports its errors with a schemaPath from that target.
 */
export function refTargets(wrapped: Obj): Obj[] {
  const out = new Set<Obj>();
  // Schema nodes only, as rewriteRefs: a "$ref" in literal data is a value.
  const visit = (node: unknown) => {
    if (!isObj(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const target = value === '#' ? wrapped : resolveRef(wrapped, value);
        if (target && target !== wrapped) out.add(target);
      } else
        mapSubschemas(key, value, (child) => {
          visit(child);
          return child;
        });
    }
  };
  visit(wrapped);
  return [...out];
}

/** Where a schemaPath leads from `root`: the object holding its last keyword, and the path without the wrapping's `else` hops. */
function walk(root: Obj, segments: string[]): { holder: unknown; out: string[] } {
  const out: string[] = [];
  let at: unknown = root;
  let holder: unknown = root;
  for (const [i, segment] of segments.entries()) {
    if (isObj(at) && at[WRAPPER] === true && segment === 'else') {
      at = at.else;
      holder = at;
      continue;
    }
    out.push(segment);
    if (i === segments.length - 1) holder = at;
    at = step(at, segment);
  }
  return { holder, out };
}

/**
 * An error of the wrapped schema, at the path of its node in the schema it was made from; undefined
 * for a wrapper's own test (its `if`), which is not a check of the schema. Ajv (verbose) gives the
 * object holding the failing keyword (`parentSchema`): a wrapper's is the wrapper itself, and the
 * path is read from whichever root leads to that object, the whole schema or a `$ref` target that Ajv
 * compiled on its own (fix round 2, R12.1).
 */
export function originalSchemaPath(wrapped: Obj, roots: Obj[], error: { schemaPath: string; parentSchema?: unknown }): string | undefined {
  if (isObj(error.parentSchema) && error.parentSchema[WRAPPER] === true) return undefined;
  const segments = error.schemaPath.replace(/^#/, '').split('/').slice(1);
  for (const root of [wrapped, ...roots]) {
    const { holder, out } = walk(root, segments);
    if (error.parentSchema === undefined || holder === error.parentSchema) return `#${out.map((segment) => `/${segment}`).join('')}`;
  }
  return error.schemaPath;
}
