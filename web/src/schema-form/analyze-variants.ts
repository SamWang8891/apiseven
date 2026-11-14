// oneOf / anyOf (and type lists) as alternatives the form can tell apart: by JSON type, by a property
// each option pins to its own values, or by the keys each option has. What cannot be told apart is JSON.
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { deref, isObj } from '../schema/refs';
import { ANNOTATIONS, broad, broadType, disjoint, json, list_, text, typeLabel, TYPES, typesOf, type Ctx } from './analyze-ctx';
import { mergedStrings, numberNode } from './analyze-scalars';
import type { Node, VariantNode } from './node';

/** `type: [...]` with more than one type. */
export function typeUnion(s: Obj, types: string[], ctx: Ctx): Node {
  const set = new Set(types);
  const numeric = types.filter((x) => x === 'integer' || x === 'number');
  if (types.every((x) => x === 'string' || x === 'integer' || x === 'number')) {
    if (set.has('string') && numeric.length > 0) return numberNode(s, !set.has('number'), true);
    if (!set.has('string')) return numberNode(s, false, false);
  }
  const options = types
    .filter((x) => !(x === 'integer' && set.has('number')))
    .map((type) => {
      const node = ctx.at({ ...s, type }, ctx);
      const accepted = broad([type]);
      return { label: typeLabel(type), node, matches: (v: unknown) => accepted.has(broadType(v)) };
    });
  return { kind: 'variant', options, schema: s };
}

/** A combinator's options, each with the parent's own keywords (type, items, …) merged in. */
function optionsOf(s: Obj, list: unknown[], ctx: Ctx): Obj[] | null {
  const base: Obj = {};
  for (const [k, v] of Object.entries(s)) if (k !== 'oneOf' && k !== 'anyOf' && !ANNOTATIONS.has(k)) base[k] = v;
  const out: Obj[] = [];
  for (const raw of list) {
    const o = deref(ctx.root, raw);
    if (!o) return null;
    out.push(Object.keys(base).length === 0 ? o : { ...base, ...o });
  }
  return out;
}

/** `oneOf` / `anyOf` on something that is not a plain object with properties. */
export function combinatorNode(s: Obj, which: 'oneOf' | 'anyOf', ctx: Ctx): Node {
  const options = optionsOf(s, s[which] as unknown[], ctx);
  if (!options || options.length === 0) return json(s, ctx);
  if (options.length === 1 && options[0]) return ctx.at(options[0], ctx);
  const typeLists = options.map(typesOf);
  if (typeLists.some((x) => x === null || x.length === 0)) return json(s, ctx);
  const types = typeLists as string[][];

  // Scalars of the same kind merge into one field: strings (ip-restriction's IPv4 | IPv4/CIDR | …),
  // or a number that also takes text (limit-count's count: integer | string).
  const flat = new Set(types.flat());
  if ([...flat].every((x) => x === 'string' || x === 'integer' || x === 'number')) {
    const numeric = options.filter((_, i) => types[i]?.some((x) => x !== 'string'));
    const integer = !flat.has('number');
    if (numeric.length === 0) return mergedStrings(s, options, ctx);
    if (numeric.length === 1 && numeric[0]) return numberNode(numeric[0], integer, flat.has('string'));
    if (!flat.has('string')) return numberNode({}, integer, false);
  }

  // Options of different JSON types: pick the form, then fill it in.
  const sets = types.map(broad);
  if (sets.every((a, i) => sets.every((b, j) => i === j || disjoint(a, b)))) {
    return {
      kind: 'variant',
      schema: s,
      options: options.map((o, i) => {
        const accepted = sets[i] ?? new Set<string>();
        // An untyped enum of one or two values is named by them (gzip's types: a list, or "*").
        const values = o.type === undefined ? (Array.isArray(o.enum) ? o.enum : 'const' in o ? [o.const] : undefined) : undefined;
        const node = ctx.at(o, ctx);
        const label =
          text(o.title) ??
          (values && values.length <= 2
            ? values.map(String).join(', ')
            : node.kind === 'map'
              ? t('sf.variant.map')
              : [...accepted].map(typeLabel).join(' / '));
        return { label, node, matches: (v: unknown) => accepted.has(broadType(v)) };
      }),
    };
  }

  if (types.every((x) => x.length === 1 && x[0] === 'object')) {
    return discriminatedObjects(s, options, ctx) ?? shapedObjects(s, options, ctx) ?? json(s, ctx);
  }
  return json(s, ctx);
}

/** The const/enum values an object option gives `key`, if it pins it. */
function pinned(o: Obj, key: string, root: Obj): unknown[] | undefined {
  const props = isObj(o.properties) ? o.properties : undefined;
  const p = props ? deref(root, props[key]) : undefined;
  if (!p) return undefined;
  if ('const' in p) return [p.const];
  return Array.isArray(p.enum) && p.enum.length > 0 ? p.enum : undefined;
}

/** A key every option pins to its own values (traffic-split's type, an auth's algorithm). */
export function discriminator(options: Obj[], root: Obj): { key: string; values: unknown[][] } | undefined {
  const first = options[0];
  if (!first || !isObj(first.properties)) return undefined;
  for (const key of Object.keys(first.properties)) {
    const values = options.map((o) => pinned(o, key, root));
    if (values.some((v) => v === undefined)) continue;
    const sets = (values as unknown[][]).map((v) => new Set(v));
    if (sets.every((a, i) => sets.every((b, j) => i === j || disjoint(a, b)))) return { key, values: values as unknown[][] };
  }
  return undefined;
}

function discriminatedObjects(s: Obj, options: Obj[], ctx: Ctx): VariantNode | undefined {
  const found = discriminator(options, ctx.root);
  if (!found) return undefined;
  const { key, values } = found;
  return {
    kind: 'variant',
    schema: s,
    options: options.map((o, i) => {
      const set = new Set(values[i]);
      return {
        label: text(o.title) ?? (values[i] ?? []).map(String).join(', '),
        node: ctx.at(o, ctx),
        matches: (v: unknown) => isObj(v) && set.has(v[key]),
        discriminant: { key, value: values[i]?.[0] },
      };
    }),
  };
}

/** What an object option looks like: named keys, or a map of keys matching patterns. */
interface Shape {
  declared?: Map<string, Set<string>>;
  map?: { patterns: string[]; types: Set<string> };
}

function shapeOf(o: Obj, root: Obj): Shape | undefined {
  const props = isObj(o.properties) ? o.properties : undefined;
  const patternProps = isObj(o.patternProperties) ? o.patternProperties : undefined;
  if (props && Object.keys(props).length > 0 && !patternProps) {
    const declared = new Map<string, Set<string>>();
    for (const [k, sub] of Object.entries(props)) {
      const p = deref(root, sub);
      const types = p ? (typesOf(p) ?? []) : [];
      declared.set(k, types.length > 0 ? broad(types) : new Set(TYPES));
    }
    return { declared };
  }
  if (patternProps && !props) {
    const types = new Set<string>();
    for (const sub of Object.values(patternProps)) {
      const p = deref(root, sub);
      if (!p) return undefined;
      const own = typesOf(p);
      const alts = [...list_(p.oneOf), ...list_(p.anyOf)];
      const list = own && own.length > 0 ? own : alts.flatMap((a) => typesOf(deref(root, a) ?? {}) ?? []);
      if (list.length === 0) return undefined;
      broad(list).forEach((x) => types.add(x));
    }
    return { map: { patterns: Object.keys(patternProps), types } };
  }
  return undefined;
}

function shapesApart(a: Shape, b: Shape): boolean {
  if (a.declared && b.declared) return disjoint(new Set(a.declared.keys()), new Set(b.declared.keys()));
  const declared = a.declared ?? b.declared;
  const map = a.map ?? b.map;
  if (!declared || !map) return false;
  // Every named key of one either cannot be a key of the other, or holds a different type.
  return [...declared].every(([, types]) => disjoint(types, map.types));
}

function fitsShape(shape: Shape, v: unknown): boolean {
  if (!isObj(v)) return false;
  const entries = Object.entries(v);
  if (entries.length === 0) return false;
  if (shape.declared) return entries.every(([k]) => shape.declared?.has(k));
  const map = shape.map;
  return map !== undefined && entries.every(([, val]) => map.types.has(broadType(val)));
}

/** Object options told apart by their keys (proxy-rewrite's headers: add/set/remove, or a plain map). */
function shapedObjects(s: Obj, options: Obj[], ctx: Ctx): VariantNode | undefined {
  const shapes = options.map((o) => shapeOf(o, ctx.root));
  if (shapes.some((x) => x === undefined)) return undefined;
  const list = shapes as Shape[];
  if (!list.every((a, i) => list.every((b, j) => i === j || shapesApart(a, b)))) return undefined;
  return {
    kind: 'variant',
    schema: s,
    options: options.map((o, i) => {
      const shape = list[i] as Shape;
      const label = text(o.title) ?? (shape.declared ? [...shape.declared.keys()].sort().join(', ') : t('sf.variant.map'));
      return { label, node: ctx.at(o, ctx), matches: (v: unknown) => fitsShape(shape, v) };
    }),
  };
}
