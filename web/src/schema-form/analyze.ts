// JSON Schema → Node: what the schema form renders for each part of a schema. Pure (no React), never
// throws, memoised per schema object. Whatever is not understood becomes a `json` node, which the
// form shows as an inline JSON editor for just that value, so nothing is ever lost or hidden.
import type { Obj } from '../api/types';
import { deref, isObj } from '../schema/refs';
import { json, strings, typesOf, type Ctx } from './analyze-ctx';
import { arrayNode, objectNode } from './analyze-objects';
import { enumNode, numberNode, stringNode } from './analyze-scalars';
import { combinatorNode, typeUnion } from './analyze-variants';
import { ANY_SCHEMA, type Node } from './node';

export * from './node';

const MAX_DEPTH = 24;
const BUDGET = 20000;

// --- Analysis --------------------------------------------------------------------------------

function analyzeAt(schema: unknown, ctx: Ctx): Node {
  if (schema === true) return json(ANY_SCHEMA, ctx);
  const s = deref(ctx.root, schema);
  if (!s) return json(isObj(schema) ? schema : ANY_SCHEMA, ctx);
  if (ctx.stack.includes(s) || ctx.stack.length > MAX_DEPTH || --ctx.budget.left < 0) return json(s, ctx);
  try {
    return analyzeSchema(s, { ...ctx, stack: [...ctx.stack, s] });
  } catch {
    return json(s, ctx);
  }
}

/** Whether a schema (or an allOf part) describes an object with fields or rules about them. */
const objectish = (s: Obj): boolean =>
  isObj(s.properties) || (typesOf(s) ?? []).includes('object') || 'if' in s || isObj(s.dependencies);

function analyzeSchema(s: Obj, ctx: Ctx): Node {
  if (Array.isArray(s.allOf)) {
    const parts = s.allOf.map((p) => deref(ctx.root, p));
    if (!parts.every(isObj)) return json(s, ctx);
    // An object merges its parts' fields and rules itself (objectPart).
    if (objectish(s) || parts.some(objectish)) return objectNode(s, ctx);
    // Anything else: the parts' constraints together.
    const merged: Obj = { ...s };
    delete merged.allOf;
    for (const p of parts) for (const [k, v] of Object.entries(p)) if (!(k in merged)) merged[k] = v;
    return Array.isArray(merged.allOf) ? json(s, ctx) : analyzeSchema(merged, ctx);
  }

  if ('const' in s) return enumNode([s.const], s, ctx);
  if (Array.isArray(s.enum) && s.enum.length > 0) return enumNode(s.enum, s, ctx);

  const types = typesOf(s);
  if (types === null) return json(s, ctx);
  // oneOf/anyOf beside an object's own fields is about those fields (objectPart); anywhere else it
  // offers alternative forms of the value.
  const fields = isObj(s.properties) && Object.keys(s.properties).length > 0;
  const combinator = Array.isArray(s.oneOf) ? 'oneOf' : Array.isArray(s.anyOf) ? 'anyOf' : undefined;
  if (combinator && !fields) return combinatorNode(s, combinator, ctx);

  const real = types.filter((x) => x !== 'null');
  if (real.length === 0) return json(s, ctx);
  if (real.length > 1) return typeUnion(s, real, ctx);
  switch (real[0]) {
    case 'string':
      return stringNode(s, ctx);
    case 'integer':
    case 'number':
      return numberNode(s, real[0] === 'integer', false);
    case 'boolean':
      return { kind: 'boolean' };
    case 'object':
      return objectNode(s, ctx);
    case 'array':
      return arrayNode(s, ctx);
    default:
      return json(s, ctx);
  }
}

// --- Entry point -----------------------------------------------------------------------------

const memo = new WeakMap<Obj, Map<string, Node>>();

/**
 * The form of `schema`. Never throws; anything not understood becomes a `json` node. Fields named
 * in the schema's own top-level `encrypt_fields` (dotted, as APISIX lists them) and in
 * `opts.encryptFields` are secret. Memoised per schema object.
 */
export function analyze(schema: Obj, opts: { encryptFields?: string[] } = {}): Node {
  const own = isObj(schema) ? strings(schema.encrypt_fields) : [];
  const encrypt = new Set([...own, ...(opts.encryptFields ?? [])]);
  const key = [...encrypt].sort().join('\n');
  let byKey = isObj(schema) ? memo.get(schema) : undefined;
  const hit = byKey?.get(key);
  if (hit) return hit;
  let node: Node;
  try {
    node = isObj(schema)
      ? analyzeAt(schema, { root: schema, encrypt, path: [], key: '', description: '', stack: [], budget: { left: BUDGET }, at: analyzeAt })
      : { kind: 'json', schema: ANY_SCHEMA };
  } catch {
    node = { kind: 'json', schema: isObj(schema) ? schema : ANY_SCHEMA };
  }
  if (isObj(schema)) {
    if (!byKey) {
      byKey = new Map();
      memo.set(schema, byKey);
    }
    byKey.set(key, node);
  }
  return node;
}
