// The one Ajv set-up for APISIX schemas: the JSON editor's lint, the schema form's conditions and
// plugin validation all compile through validatorFor, validate through schemaErrors, and keep the
// errors worth showing with specificErrors (fieldErrors does both and gives form-ready paths).
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { SchemaEnv } from 'ajv/dist/compile';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { normalize, originalSchemaPath, refTargets, skippingSecretRefs, type SchemaGaps } from './prepare';
import { deref, isObj, resolveRef } from './refs';

export type { SchemaGap, SchemaGaps } from './prepare';

// strict: false, since APISIX schemas carry keys Ajv does not know (encrypt_fields, $comment on
// odd places); formats are not checked (ip-restriction's ipv4/ipv6 would need ajv-formats, and the
// server checks them anyway), so a format this browser does not know refuses nothing either: each is
// a gap the note names (prepare.ts; Task 16b, item 153).
// verbose: an error carries the schema object holding its keyword, which tells the wrapping's own tests
// from the schema's (prepare.ts originalSchemaPath). It also carries the value checked (`data`), and a
// compiled validator keeps its last errors: run() drops both after every check (final wave C2), so a
// secret typed into a form and discarded is not kept here.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, verbose: true });

/** A compiled check: whether the value passes, keeping nothing of it (run). */
export type Check = (value: unknown) => boolean;

interface Compiled {
  /** The validator of the wrapped copy (prepare.ts: secret references skipped as APISIX skips them). */
  validate: ValidateFunction | null;
  /** `validate` as validatorFor hands it out. */
  check: Check | null;
  /** What it compiled, to map its errors back to the schema's own paths, and its `$ref` targets. */
  wrapped: Obj | undefined;
  roots: Obj[];
  /** The normalized copy, unwrapped (for `secretRefs: false`). */
  normalized: Obj;
  plain?: ValidateFunction | null;
  /** What the checks leave to APISIX (prepare.ts); undefined when nothing. */
  gaps: SchemaGaps | undefined;
  /** The formats left to APISIX, by name. */
  formats: string[];
}
const compiled = new WeakMap<Obj, Compiled>();

function ajvCompile(schema: Obj): ValidateFunction | null {
  try {
    return ajv.compile(schema);
  } catch {
    return null;
  } finally {
    // Keeps the instance from collecting schemas, and two schemas with the same $id from clashing.
    ajv.removeSchema(schema);
  }
}

function compile(schema: Obj): Compiled {
  let entry = compiled.get(schema);
  if (entry === undefined) {
    const prepared = normalize(schema);
    const wrapped = prepared.gaps === 'all' ? undefined : skippingSecretRefs(prepared.schema);
    const validate = wrapped ? ajvCompile(wrapped) : null;
    entry = {
      validate,
      check: validate && ((value) => run(validate, value).ok),
      wrapped,
      roots: wrapped ? refTargets(wrapped) : [],
      normalized: prepared.schema,
      gaps: validate === null ? 'all' : prepared.gaps.length > 0 ? prepared.gaps : undefined,
      formats: prepared.formats,
    };
    compiled.set(schema, entry);
  }
  return entry;
}

/**
 * Clears the last errors `validate` keeps, and those of every part of it Ajv compiled on its own (a
 * $ref it did not inline, a recursive one): each keeps its own.
 */
function forget(validate: ValidateFunction): void {
  validate.errors = null;
  const seen = new Set<SchemaEnv>();
  const walk = (env: SchemaEnv) => {
    if (seen.has(env)) return;
    seen.add(env);
    if (env.validate) env.validate.errors = null;
    for (const ref of Object.values(env.refs) as unknown[]) if (ref !== null && typeof ref === 'object' && 'refs' in ref) walk(ref as SchemaEnv);
  };
  walk(validate.schemaEnv);
}

/** A copy of an Ajv error without the value it was about (verbose's `data`); the schema parts stay. */
function withoutData(error: ErrorObject): ErrorObject {
  const copy = { ...error };
  delete copy.data;
  return copy;
}

/**
 * `validate` run on `value`: whether it passed and its errors, none of them holding the value; the
 * validator and every part of it keep no errors afterwards (final wave C2: verbose errors hold the
 * value checked, a secret typed into a form among them). Every check goes through here.
 */
function run(validate: ValidateFunction, value: unknown): { ok: boolean; errors: ErrorObject[] } {
  const ok = validate(value);
  const errors = ok ? [] : (validate.errors ?? []).map(withoutData);
  forget(validate);
  return { ok, errors };
}

/**
 * For tests: the errors the validators compiled for `schema` still keep, those of every part Ajv
 * compiled on its own included; [] when none. It walks Ajv's compiled schemas itself, so a part
 * run() missed is found.
 */
export function keptByValidators(schema: Obj): unknown[] {
  const entry = compiled.get(schema);
  const out: unknown[] = [];
  const seen = new Set<SchemaEnv>();
  const visit = (env: SchemaEnv) => {
    if (seen.has(env)) return;
    seen.add(env);
    out.push(...(env.validate?.errors ?? []));
    for (const ref of Object.values(env.refs) as unknown[]) if (ref !== null && typeof ref === 'object' && 'refs' in ref) visit(ref as SchemaEnv);
  };
  for (const validate of [entry?.validate, entry?.plain]) if (validate) visit(validate.schemaEnv);
  return out;
}

/**
 * Compiles once per schema object (the copy prepare.ts makes: it leaves to APISIX what the browser
 * cannot read, never refusing more for it, and skips a secret reference wherever APISIX does); null
 * when Ajv cannot compile it (callers then skip validation). What it left out is schemaGaps'. The
 * check keeps nothing of what it is given (run).
 */
export function validatorFor(schema: Obj): Check | null {
  return compile(schema).check;
}

/** Whether to skip secret references as APISIX does (the default); false only to compare with the check without it. */
export interface CheckOptions {
  secretRefs?: boolean;
}

/** The errors `validate` found, at the schema's own paths: the wrapping's own tests dropped. */
function mapped(entry: Compiled, errors: ErrorObject[]): ErrorObject[] {
  const wrapped = entry.wrapped;
  if (!wrapped) return errors;
  const out: ErrorObject[] = [];
  for (const error of errors) {
    const schemaPath = originalSchemaPath(wrapped, entry.roots, error);
    if (schemaPath !== undefined) out.push({ ...error, schemaPath });
  }
  return out;
}

/** What `schema`'s checks leave to APISIX (prepare.ts SchemaGaps), or undefined when they cover it whole. */
export function schemaGaps(schema: Obj): SchemaGaps | undefined {
  return compile(schema).gaps;
}

/** The formats `schema` holds, which the browser leaves to APISIX (the 'formats' gap), by name. */
export function skippedFormats(schema: Obj): string[] {
  return compile(schema).formats;
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

/**
 * Ajv's errors for `value` (defaults applied first, as APISIX does), at the schema's own paths: []
 * when valid, null when the schema does not compile. A secret reference is accepted wherever APISIX
 * skips it (prepare.ts), unless `secretRefs` is false.
 */
export function schemaErrors(schema: Obj, value: unknown, opts: CheckOptions = {}): ErrorObject[] | null {
  const entry = compile(schema);
  if (opts.secretRefs === false) {
    if (!entry.validate) return null;
    entry.plain ??= ajvCompile(entry.normalized);
    const plain = entry.plain;
    if (!plain) return null;
    return run(plain, withDefaults(schema, value)).errors;
  }
  const validate = entry.validate;
  if (!validate) return null;
  return mapped(entry, run(validate, withDefaults(schema, value)).errors);
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

/** `value` with the JSON at `pointer` replaced, copying only along the way; `value` itself when there is nothing there. */
function replaceAt(value: unknown, keys: string[], next: unknown): unknown {
  const [key, ...rest] = keys;
  if (key === undefined) return next;
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    const i = Number(key);
    if (!(i in list)) return list;
    const copy = [...list];
    copy[i] = replaceAt(list[i], rest, next);
    return copy;
  }
  if (!isObj(value) || !Object.hasOwn(value, key)) return value;
  return { ...value, [key]: replaceAt(value[key], rest, next) };
}

/**
 * `value` (defaults applied) with each empty table read as the type its schema position asks for,
 * `[]` as `{}` where an object is wanted and `{}` as `[]` where a list is, as APISIX's validator reads
 * an empty Lua table: then minItems, required and the rest apply to it as APISIX applies them. Each
 * place is turned once (a branch of a combinator may want the other type).
 */
function asLuaTables(schema: Obj, value: unknown, opts: CheckOptions): unknown {
  let current = withDefaults(schema, value);
  const turned = new Set<string>();
  for (let round = 0; round < 16; round += 1) {
    const error = (schemaErrors(schema, current, opts) ?? []).find((e) => !turned.has(e.instancePath) && emptyTableTypeError(e, current));
    if (!error) break;
    turned.add(error.instancePath);
    const wanted = String((error.params as Record<string, unknown>).type).split(',');
    const at = valueAt(current, error.instancePath);
    const read = Array.isArray(at) ? (wanted.includes('object') ? {} : at) : wanted.includes('array') ? [] : at;
    current = replaceAt(current, pointerKeys(error.instancePath), read);
  }
  return current;
}

/**
 * What is wrong with `value`, for showing beside fields: specificErrors, each at a dotted path (array
 * indices as numbers) and a missing required property at its own path (reading "Required"),
 * duplicates once. [] when
 * valid; null when the schema does not compile (the caller then shows nothing; APISIX decides).
 * `luaTables`: an empty `[]` or `{}` is read as the list or object its position asks for (asLuaTables),
 * as APISIX's validator reads it (plugins, plugin metadata, secret managers: what APISIX stores).
 */
export function fieldErrors(schema: Obj, value: unknown, opts: { luaTables?: boolean } & CheckOptions = {}): FieldError[] | null {
  const input = opts.luaTables ? asLuaTables(schema, value, opts) : value;
  const all = schemaErrors(schema, input, opts);
  if (all === null) return null;
  const seen = new Set<string>();
  const out: FieldError[] = [];
  for (const error of specificErrors(schema, withDefaults(schema, input), all)) {
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
