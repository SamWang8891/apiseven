// What the analysis carries down a schema (Ctx), and the small helpers its parts share.
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { isObj } from '../schema/refs';
import { ANY_SCHEMA, jsonType, type JsonNode, type Node } from './node';

export interface Ctx {
  root: Obj;
  encrypt: Set<string>;
  /** Object keys from the root to here; array levels are transparent, as in APISIX's encrypt_fields. */
  path: string[];
  /** The property this schema describes, and its description: hints for multi-line, secret and mono. */
  key: string;
  description: string;
  /** Schemas being analysed above this one: a schema met again is a cycle. */
  stack: Obj[];
  /** Work left for this analysis: a hostile schema that multiplies (oneOf of oneOfs …) runs out of it. */
  budget: { left: number };
  /** The analysis itself (analyze.ts), for the parts of a schema inside this one. */
  at: (schema: unknown, ctx: Ctx) => Node;
}

export function json(schema: unknown, ctx: Ctx): JsonNode {
  if (!isObj(schema)) return { kind: 'json', schema: ANY_SCHEMA };
  // A sub-schema may $ref the root's definitions: they go beside it, so it can be checked on its own.
  const defs = ['definitions', '$defs'].filter((k) => isObj(ctx.root[k]) && !(k in schema));
  if (defs.length === 0 || schema === ctx.root) return { kind: 'json', schema };
  return { kind: 'json', schema: { ...schema, ...Object.fromEntries(defs.map((k) => [k, ctx.root[k]])) } };
}

/** An array as unknown[] (anything else as []), so its items get checked before use. */
export const list_ = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

export const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/**
 * The types a schema allows: its `type`, else what its keywords imply. [] = any; null = a `type`
 * that is not a JSON type (or not a string/array of strings), which only the JSON editor can show.
 */
export function typesOf(s: Obj): string[] | null {
  const type = s.type;
  if (typeof type === 'string') return TYPES.has(type) ? [type] : null;
  if (Array.isArray(type)) {
    const list = type.filter((x): x is string => typeof x === 'string' && TYPES.has(x));
    return list.length === type.length && list.length > 0 ? [...new Set(list)] : null;
  }
  if (type !== undefined) return null;
  const values = 'const' in s ? [s.const] : Array.isArray(s.enum) ? s.enum : undefined;
  if (values) return [...new Set(values.map((v) => (jsonType(v) === 'integer' ? 'number' : jsonType(v))))];
  const has = (...keys: string[]) => keys.some((k) => k in s);
  if (has('properties', 'patternProperties', 'required', 'minProperties', 'maxProperties', 'dependencies') || isObj(s.additionalProperties)) {
    return ['object'];
  }
  if (has('items', 'minItems', 'maxItems', 'uniqueItems', 'contains')) return ['array'];
  if (has('minLength', 'maxLength', 'pattern', 'format')) return ['string'];
  if (has('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf')) return ['number'];
  return [];
}

/** Types with integer folded into number, for telling options apart. */
export const broad = (types: string[]): Set<string> => new Set(types.map((x) => (x === 'integer' ? 'number' : x)));

/** A value's JSON type, with integer folded into number. */
export const broadType = (v: unknown): string => (jsonType(v) === 'integer' ? 'number' : jsonType(v));

export const disjoint = (a: Set<unknown>, b: Set<unknown>) => [...a].every((x) => !b.has(x));

export function typeLabel(type: string): string {
  return t(`sf.type.${type}`);
}

/** Keys that only annotate or constrain, never add a field. */
export const ANNOTATIONS = new Set(['title', 'description', '$comment', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
