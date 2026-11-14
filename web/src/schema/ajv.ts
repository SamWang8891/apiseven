// The one Ajv set-up for APISIX schemas: the JSON editor's lint, the schema form's conditions and
// plugin validation all compile through validatorFor, and validate through schemaErrors.
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { Obj } from '../api/types';
import { deref, isObj } from './refs';

// strict: false, since APISIX schemas carry keys Ajv does not know (encrypt_fields, $comment on
// odd places); formats are not checked (ip-restriction's ipv4/ipv6 would need ajv-formats, and the
// server checks them anyway).
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new WeakMap<Obj, ValidateFunction | null>();

/**
 * A copy Ajv 8 (draft-07) accepts: no `$schema` (a draft-04 URI would not resolve), and draft-04's
 * boolean `exclusiveMinimum` / `exclusiveMaximum` turned into the draft-07 numbers.
 */
function normalize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalize);
  if (!isObj(schema)) return schema;
  const out: Obj = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples') out[key] = value;
    else out[key] = normalize(value);
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

/** Compiles once per schema object; null when Ajv cannot compile it (callers then skip validation). */
export function validatorFor(schema: Obj): ValidateFunction | null {
  let validate = validators.get(schema);
  if (validate === undefined) {
    const copy = normalize(schema) as Obj;
    try {
      validate = ajv.compile(copy);
    } catch {
      validate = null;
    } finally {
      // Keeps the instance from collecting schemas, and two schemas with the same $id from clashing.
      ajv.removeSchema(copy);
    }
    validators.set(schema, validate);
  }
  return validate;
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
