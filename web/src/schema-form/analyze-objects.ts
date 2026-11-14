// Objects (fields, required sets, conditions, dependencies, display order) and arrays.
import type { Obj } from '../api/types';
import { deref, isObj } from '../schema/refs';
import { ANNOTATIONS, json, num, strings, text, type Ctx } from './analyze-ctx';
import { discriminator } from './analyze-variants';
import { ANY_SCHEMA, isWide, type ArrayBounds, type MapNode, type Conditional, type Node, type ObjectNode, type ObjectPart, type Prop } from './node';

/**
 * Display order: required fields (in the schema's `required` order), then the one-line fields of
 * the first alternative (limit-count's count, time_window), then the other one-line fields, then the
 * wide ones, each alphabetically; `_`-prefixed keys (APISIX's _meta) last. APISIX serialises its Lua
 * tables in hash order, so the schema's own key order carries no meaning.
 */
function ordered(props: Prop[], required: string[], preferred: string[]): Prop[] {
  const rank = (p: Prop): [number, number] => {
    if (required.includes(p.key)) return [0, required.indexOf(p.key)];
    if (p.key.startsWith('_')) return [5, 0];
    if (!isWide(p.node) && preferred.includes(p.key)) return [1, preferred.indexOf(p.key)];
    return [isWide(p.node) ? 3 : 2, 0];
  };
  return props
    .map((p) => ({ p, r: rank(p) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || (a.p.key < b.p.key ? -1 : a.p.key > b.p.key ? 1 : 0))
    .map((x) => x.p);
}

/** Whether a sub-schema only constrains keys already known (adds no field of its own). */
function constrainsOnly(sub: unknown, known: Set<string>, root: Obj, depth = 0): boolean {
  const s = deref(root, sub);
  if (!s || depth > 8) return false;
  return Object.entries(s).every(([k, v]) => {
    if (ANNOTATIONS.has(k) || k === 'required' || k === 'minProperties' || k === 'maxProperties' || k === 'type') return true;
    if (k === 'properties') return isObj(v) && Object.keys(v).every((p) => known.has(p));
    if (k === 'not') return true;
    if (k === 'allOf' || k === 'anyOf' || k === 'oneOf') return Array.isArray(v) && v.every((x) => constrainsOnly(x, known, root, depth + 1));
    if (k === 'if' || k === 'then' || k === 'else') return constrainsOnly(v, known, root, depth + 1);
    if (k === 'dependencies') return isObj(v) && Object.values(v).every((d) => Array.isArray(d) || constrainsOnly(d, known, root, depth + 1));
    return false;
  });
}

/** `{required: [...]}` and nothing else that matters. */
function requiredSet(sub: unknown, root: Obj): string[] | undefined {
  const s = deref(root, sub);
  if (!s || !Array.isArray(s.required)) return undefined;
  if (!Object.keys(s).every((k) => k === 'required' || ANNOTATIONS.has(k))) return undefined;
  return strings(s.required);
}

function propOf(key: string, raw: unknown, required: boolean, ctx: Ctx): Prop {
  const target = deref(ctx.root, raw);
  const outer = isObj(raw) ? raw : {};
  const description = text(outer.description) ?? text(target?.description);
  const node = ctx.at(raw, { ...ctx, key, description: description ?? '', path: [...ctx.path, key] });
  const prop: Prop = { key, node, required };
  const title = text(outer.title) ?? text(target?.title);
  if (title !== undefined) prop.title = title;
  if (description !== undefined) prop.description = description;
  if ('default' in outer) prop.default = outer.default;
  else if (target && 'default' in target) prop.default = target.default;
  return prop;
}

/**
 * The fields and rules of an object schema (or of a then/else/dependency part of one). `known`
 * holds the keys of the object being built, so parts that only constrain them add no field.
 */
function objectPart(s: Obj, ctx: Ctx, known: Set<string>): ObjectPart {
  const part: ObjectPart = { props: [], alternatives: [], dependents: {}, conditionals: [] };
  const pieces = [s, ...(Array.isArray(s.allOf) ? s.allOf.map((p) => deref(ctx.root, p)).filter(isObj) : [])];
  const schemas = new Map<string, unknown>();
  const required = new Set<string>();
  for (const piece of pieces) {
    if (isObj(piece.properties)) for (const [k, v] of Object.entries(piece.properties)) if (!schemas.has(k)) schemas.set(k, v);
    strings(piece.required).forEach((k) => required.add(k));
  }
  const keys = new Set([...known, ...schemas.keys()]);
  for (const [key, raw] of schemas) part.props.push(propOf(key, raw, required.has(key), ctx));

  for (const piece of pieces) {
    for (const which of ['oneOf', 'anyOf'] as const) {
      const list = piece[which];
      if (Array.isArray(list) && list.length > 0) combinatorPart(which, list, part, keys, ctx);
    }
    if ('if' in piece && (isObj(piece.then) || isObj(piece.else))) {
      const cond: Conditional = { when: isObj(piece.if) ? piece.if : null };
      const thenPart = deref(ctx.root, piece.then);
      const elsePart = deref(ctx.root, piece.else);
      if (thenPart) cond.then = objectPart(thenPart, ctx, keys);
      if (elsePart) cond.else = objectPart(elsePart, ctx, keys);
      part.conditionals.push(cond);
    }
    if (isObj(piece.dependencies)) {
      for (const [key, dep] of Object.entries(piece.dependencies)) {
        const set = Array.isArray(dep) ? strings(dep) : requiredSet(dep, ctx.root);
        if (set) part.dependents[key] = [...(part.dependents[key] ?? []), ...set];
        else if (!constrainsOnly(dep, keys, ctx.root)) {
          const d = deref(ctx.root, dep);
          if (d) part.conditionals.push({ when: { required: [key] }, then: objectPart(d, ctx, keys) });
        }
      }
    }
  }
  part.props = ordered(part.props, [...required], part.alternatives.flatMap((a) => a.sets.flat()));
  return part;
}

function combinatorPart(which: 'oneOf' | 'anyOf', list: unknown[], part: ObjectPart, keys: Set<string>, ctx: Ctx) {
  const sets = list.map((o) => requiredSet(o, ctx.root));
  if (sets.every((x): x is string[] => x !== undefined)) {
    part.alternatives.push({ mode: which, sets });
    return;
  }
  if (list.every((o) => constrainsOnly(o, keys, ctx.root))) return; // left to Ajv
  const options = list.map((o) => deref(ctx.root, o));
  if (options.every(isObj)) {
    const found = discriminator(options, ctx.root);
    if (found && keys.has(found.key)) {
      // The object's own property picks which extra fields apply (jwt-auth's algorithm → public_key).
      options.forEach((o, i) => {
        part.conditionals.push({
          when: { required: [found.key], properties: { [found.key]: { enum: found.values[i] } } },
          then: objectPart(o, ctx, keys),
        });
      });
      return;
    }
    // Options that add fields of their own: all of them shown, the choice left to Ajv.
    for (const o of options) {
      for (const prop of objectPart(o, ctx, keys).props) {
        if (!keys.has(prop.key)) {
          keys.add(prop.key);
          part.props.push({ ...prop, required: false });
        }
      }
    }
  }
}

const SCHEMA_VALUED = /schema/i;
const LITERAL_NAME = /^[A-Za-z_][\w-]*$/;

export function objectNode(s: Obj, ctx: Ctx): Node {
  const props = isObj(s.properties) ? s.properties : {};
  const patternProps = isObj(s.patternProperties) ? Object.entries(s.patternProperties) : [];
  const additional = s.additionalProperties;
  const hasProps = Object.keys(props).length > 0 || (Array.isArray(s.allOf) && s.allOf.length > 0);

  // Fields written as patternProperties of plain names, nothing else allowed (ai-proxy's auth:
  // header, query, gcp, aws): named fields, not a map.
  if (!hasProps && additional === false && patternProps.length > 0 && patternProps.every(([p]) => LITERAL_NAME.test(p))) {
    const named: Obj = { ...s, properties: Object.fromEntries(patternProps) };
    delete named.patternProperties;
    return objectNode(named, ctx);
  }

  if (!hasProps && (patternProps.length > 0 || isObj(additional))) {
    const schemas = patternProps.length > 0 ? patternProps.map(([, v]) => v) : [additional];
    const nodes = schemas.map((v) => ctx.at(v, ctx));
    const value = nodes.length === 1 && nodes[0] ? nodes[0] : json(s, ctx);
    if (value.kind === 'json' && nodes.length > 1) return json(s, ctx);
    const node: MapNode = { kind: 'map', value, patterns: patternProps.map(([p]) => p) };
    if (num(s.minProperties) !== undefined) node.minProperties = num(s.minProperties);
    return node;
  }
  if (!hasProps) {
    // A free-form object: a map of anything (log_format's name → $variable). One that holds a JSON
    // schema (request-validation's body_schema) is edited as JSON.
    if (additional === false || SCHEMA_VALUED.test(ctx.key) || SCHEMA_VALUED.test(ctx.description)) return json(s, ctx);
    const node: MapNode = { kind: 'map', value: json(ANY_SCHEMA, ctx), patterns: [] };
    if (num(s.minProperties) !== undefined) node.minProperties = num(s.minProperties);
    return node;
  }
  const part = objectPart(s, ctx, new Set());
  const node: ObjectNode = { kind: 'object', allowsExtra: additional !== false, ...part };
  if (num(s.minProperties) !== undefined) node.minProperties = num(s.minProperties);
  return node;
}

// --- Arrays ----------------------------------------------------------------------------------

const TAGGABLE = (node: Node): boolean =>
  (node.kind === 'string' && !node.multiline && !node.secret) ||
  node.kind === 'number' ||
  (node.kind === 'enum' && node.values.every((v) => typeof v === 'number' || typeof v === 'string'));

export function arrayNode(s: Obj, ctx: Ctx): Node {
  const items = s.items;
  if (Array.isArray(items) || items === undefined || items === true) return json(s, ctx);
  const item = ctx.at(items, ctx);
  const bounds: ArrayBounds = {};
  if (num(s.minItems) !== undefined) bounds.minItems = num(s.minItems);
  if (num(s.maxItems) !== undefined) bounds.maxItems = num(s.maxItems);
  if (s.uniqueItems === true) bounds.unique = true;
  if (TAGGABLE(item)) return { kind: 'array-scalar', item, ...bounds };
  const listable =
    item.kind === 'object' ||
    item.kind === 'map' ||
    item.kind === 'string' ||
    (item.kind === 'variant' && item.options.every((o) => o.node.kind === 'object' || o.node.kind === 'map'));
  return listable ? { kind: 'array-object', item, ...bounds } : json(s, ctx);
}
