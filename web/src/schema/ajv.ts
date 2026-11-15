// The one Ajv set-up for APISIX schemas: the JSON editor's lint, the schema form's conditions and
// plugin validation all compile through validatorFor, validate through schemaErrors, and keep the
// errors worth showing with specificErrors (fieldErrors does both and gives form-ready paths).
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { deref, isObj, resolveRef } from './refs';

// strict: false, since APISIX schemas carry keys Ajv does not know (encrypt_fields, $comment on
// odd places); formats are not checked (ip-restriction's ipv4/ipv6 would need ajv-formats, and the
// server checks them anyway), so a format this browser does not know refuses nothing either.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new WeakMap<Obj, ValidateFunction | null>();

/**
 * What a schema's checks leave to APISIX (Task 16 B18, failing open): 'patterns' when a `pattern` or
 * a `patternProperties` key JavaScript cannot compile was skipped (APISIX reads them with PCRE:
 * openwhisk's `\A…\z`), 'all' when Ajv cannot compile the schema at all; absent when nothing is.
 */
export type SchemaGaps = 'patterns' | 'all';
const gaps = new WeakMap<Obj, SchemaGaps | undefined>();

/** Whether Ajv can compile `pattern`: it builds `new RegExp(pattern, 'u')` (its default unicodeRegExp). */
function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

/**
 * A copy Ajv 8 (draft-07) accepts: no `$schema` (a draft-04 URI would not resolve), and draft-04's
 * boolean `exclusiveMinimum` / `exclusiveMaximum` turned into the draft-07 numbers. A `pattern`
 * JavaScript cannot compile is left out, and so is a `patternProperties` key, together with that
 * object's `additionalProperties` (the keys the pattern meant would be refused as additional):
 * `skipped.patterns` says so. Without this, one such pattern made the whole schema uncompilable.
 */
function normalize(schema: unknown, skipped: { patterns: boolean }): unknown {
  if (Array.isArray(schema)) return schema.map((item) => normalize(item, skipped));
  if (!isObj(schema)) return schema;
  const out: Obj = {};
  let unreadKeys = false;
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples') out[key] = value;
    else if (key === 'pattern' && typeof value === 'string' && !compiles(value)) skipped.patterns = true;
    else if (key === 'patternProperties' && isObj(value)) {
      const kept: Obj = {};
      for (const [pattern, sub] of Object.entries(value)) {
        if (compiles(pattern)) kept[pattern] = normalize(sub, skipped);
        else unreadKeys = true;
      }
      out[key] = kept;
    } else out[key] = normalize(value, skipped);
  }
  if (unreadKeys) {
    skipped.patterns = true;
    delete out.additionalProperties;
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

/**
 * Compiles once per schema object; null when Ajv cannot compile it (callers then skip validation).
 * What it had to leave out is schemaGaps'.
 */
export function validatorFor(schema: Obj): ValidateFunction | null {
  let validate = validators.get(schema);
  if (validate === undefined) {
    const skipped = { patterns: false };
    const copy = normalize(schema, skipped) as Obj;
    try {
      validate = ajv.compile(copy);
    } catch {
      validate = null;
    } finally {
      // Keeps the instance from collecting schemas, and two schemas with the same $id from clashing.
      ajv.removeSchema(copy);
    }
    validators.set(schema, validate);
    gaps.set(schema, validate === null ? 'all' : skipped.patterns ? 'patterns' : undefined);
  }
  return validate;
}

/** What `schema`'s checks leave to APISIX (SchemaGaps), or undefined when they cover it whole. */
export function schemaGaps(schema: Obj): SchemaGaps | undefined {
  validatorFor(schema);
  return gaps.get(schema);
}

/** The `properties` of `schema` with its $ref followed and its allOf parts merged in. */
function propertiesOf(root: Obj, schema: Obj): Obj {
  const props: Obj = {};
  const parts: unknown[] = [schema, ...(Array.isArray(schema.allOf) ? (schema.allOf as unknown[]) : [])];
  for (const part of parts) {
    const s = deref(root, part);
    if (s && isObj(s.properties)) for (const [k, v] of Object.entries(s.properties)) props[k] ??= v;
  }
  return props;
}

function fill(root: Obj, schema: unknown, value: unknown, depth: number): unknown {
  const s = deref(root, schema);
  if (!s || depth > 32) return value;
  if (Array.isArray(value)) {
    const items = deref(root, s.items);
    return items ? value.map((v) => fill(root, items, v, depth + 1)) : value;
  }
  if (!isObj(value)) return value;
  const out: Obj = { ...value };
  for (const [key, sub] of Object.entries(propertiesOf(root, s))) {
    const prop = deref(root, sub);
    if (!prop) continue;
    if (out[key] === undefined && 'default' in prop) out[key] = structuredClone(prop.default);
    if (out[key] !== undefined) out[key] = fill(root, prop, out[key], depth + 1);
  }
  return out;
}

/**
 * A copy of `value` with every missing property that has a `default` filled in, following
 * `properties` (and allOf parts, $refs, array items) but not oneOf/anyOf/if branches. APISIX's
 * validator injects defaults this way before it checks if/then, so `limit-count` without a
 * `policy` is "local" there, not a match for `if: {policy: {enum: ["redis"]}}`.
 */
export function withDefaults(schema: Obj, value: unknown): unknown {
  return fill(schema, schema, value, 0);
}

/** Ajv's errors for `value` (defaults applied first, as APISIX does): [] when valid, null when the schema does not compile. */
export function schemaErrors(schema: Obj, value: unknown): ErrorObject[] | null {
  const validate = validatorFor(schema);
  if (!validate) return null;
  return validate(withDefaults(schema, value)) ? [] : [...(validate.errors ?? [])];
}

/** The keys of a JSON pointer (Ajv's instancePath), unescaped. */
const pointerKeys = (pointer: string): string[] =>
  pointer === '' ? [] : pointer.split('/').slice(1).map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));

function valueAt(value: unknown, pointer: string): unknown {
  let at = value;
  for (const key of pointerKeys(pointer)) at = isObj(at) ? at[key] : Array.isArray(at) ? at[Number(key)] : undefined;
  return at;
}

/** How many keys of `value` the branch schema names (in `required` or `properties`): how far the value went down it. */
function touched(schema: Obj, branchPath: string, value: unknown): number {
  const branch = resolveRef(schema, branchPath);
  if (!branch || !isObj(value)) return 0;
  const named = new Set<string>([
    ...(Array.isArray(branch.required) ? branch.required.filter((k): k is string => typeof k === 'string') : []),
    ...(isObj(branch.properties) ? Object.keys(branch.properties) : []),
  ]);
  return Object.keys(value).filter((k) => named.has(k)).length;
}

/**
 * The errors worth showing, from Ajv's `errors` for `value` against `schema`:
 * - an `if` summary ("must match then schema") goes when the failing branch has errors of its own;
 * - a failed `anyOf` / `oneOf` whose branches have errors of their own loses its summary and keeps
 *   one branch's errors: the branch the value went furthest down (most of its keys named by the
 *   branch's `required` / `properties`), then the one with the fewest errors other than missing
 *   properties, then the first. So limit-count `{}` asks for `count` and `time_window` (not also
 *   `rules`), and `{rules: …}` reports what is wrong with `rules`.
 * - A summary with no branch errors (a value matching two sides of a oneOf) stays.
 */
export function specificErrors(schema: Obj, value: unknown, errors: ErrorObject[]): ErrorObject[] {
  let kept = errors.length > 1 ? errors.filter((e) => e.keyword !== 'if') : errors;
  // Innermost combinators first, so an outer one weighs branches already cleaned up.
  const summaries = kept
    .filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf')
    .sort((a, b) => b.schemaPath.length - a.schemaPath.length);
  for (const summary of summaries) {
    const prefix = `${summary.schemaPath}/`;
    const branches = new Map<string, ErrorObject[]>();
    for (const e of kept) {
      if (!e.schemaPath.startsWith(prefix)) continue;
      const index = e.schemaPath.slice(prefix.length).split('/')[0] ?? '';
      branches.set(index, [...(branches.get(index) ?? []), e]);
    }
    if (branches.size === 0) continue;
    const data = valueAt(value, summary.instancePath);
    const rank = ([index, list]: [string, ErrorObject[]]) => ({
      index: Number(index),
      depth: touched(schema, `${prefix}${index}`, data),
      wrong: list.filter((e) => e.keyword !== 'required').length,
    });
    const best = [...branches]
      .map(rank)
      .sort((a, b) => b.depth - a.depth || a.wrong - b.wrong || a.index - b.index)[0];
    const keep = `${prefix}${best?.index ?? 0}/`;
    kept = kept.filter((e) => e !== summary && (!e.schemaPath.startsWith(prefix) || e.schemaPath.startsWith(keep)));
  }
  return kept;
}

/** Ajv's message, naming the property `additionalProperties` refuses and the values an enum allows. */
export function errorMessage(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (error.keyword === 'additionalProperties') return `must NOT have additional property "${String(params.additionalProperty)}"`;
  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) {
    return `must be one of ${params.allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  return error.message ?? error.keyword;
}

/** An error placed on a field: dotted path relative to the value ('' = the value itself, `rules.0.match`). */
export interface FieldError {
  path: string;
  message: string;
}

/** A `type` error at an empty `[]` or `{}` asked to be an object or a list: APISIX's validator takes an empty table for both (api/lua.ts). */
function emptyTableTypeError(error: ErrorObject, value: unknown): boolean {
  if (error.keyword !== 'type') return false;
  const at = valueAt(value, error.instancePath);
  const empty = (Array.isArray(at) && at.length === 0) || (isObj(at) && Object.keys(at).length === 0);
  const wanted = String((error.params as Record<string, unknown>).type).split(',');
  return empty && wanted.some((type) => type === 'object' || type === 'array');
}

/**
 * What is wrong with `value`, for showing beside fields: specificErrors, each at a dotted path (array
 * indices as numbers) and a missing required property at its own path (reading "Required"),
 * duplicates once. [] when
 * valid; null when the schema does not compile (the caller then shows nothing; APISIX decides).
 * `luaTables`: an empty `[]` or `{}` passes as either a list or an object, as in APISIX's validator
 * (used where the check blocks a save of something APISIX stores: plugin metadata, secret managers).
 */
export function fieldErrors(schema: Obj, value: unknown, opts: { luaTables?: boolean } = {}): FieldError[] | null {
  const all = schemaErrors(schema, value);
  if (all === null) return null;
  const errors = opts.luaTables ? all.filter((error) => !emptyTableTypeError(error, withDefaults(schema, value))) : all;
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const error of specificErrors(schema, withDefaults(schema, value), errors)) {
    const keys = pointerKeys(error.instancePath);
    const missing = (error.params as Record<string, unknown>).missingProperty;
    const isMissing = error.keyword === 'required' && typeof missing === 'string';
    if (isMissing) keys.push(missing);
    // At the missing property's own path, "must have required property 'x'" would repeat its name.
    const item = { path: keys.join('.'), message: isMissing ? t('schema.required') : errorMessage(error) };
    const id = `${item.path}\n${item.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}
