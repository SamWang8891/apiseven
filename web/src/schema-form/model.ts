// What the form shows for a given value: which fields an object shows (conditions, alternatives,
// dependencies), which option of a variant is active, how a map is edited, whether a value fits its
// node at all (if not, it is shown as JSON). Pure; shared by the field components and errors.ts.
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { schemaGaps, validatorFor } from '../schema/ajv';
import { holdsPrivateKey } from '../schema/secrets';
import { DECIMAL_TEXT, exactly } from '../ui/decimal';
import { isObj } from '../schema/refs';
import { ANY_SCHEMA, jsonType, type MapNode, type Node, type ObjectNode, type ObjectPart, type Prop, type VariantNode } from './analyze';

export type Key = string | number;

/** undefined, '', [] and {}: values a field treats as "not set". */
export function isEmpty(v: unknown): boolean {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
}

/** A copy of `obj` with `key` set, or removed when `value` is undefined. Key order is kept. */
export function setKey(obj: Obj, key: string, value: unknown): Obj {
  if (value === undefined) {
    if (!(key in obj)) return obj;
    const copy = { ...obj };
    delete copy[key];
    return copy;
  }
  return { ...obj, [key]: value };
}

/** The value a new list row or map entry starts with. */
export function blankOf(node: Node): unknown {
  switch (node.kind) {
    case 'object':
    case 'map':
      return {};
    case 'string':
      return '';
    case 'variant':
      return node.options[0] ? blankOf(node.options[0].node) : {};
    case 'array-scalar':
    case 'array-object':
      return [];
    default:
      return undefined;
  }
}

/** Numeric text a double would round (ui/decimal.ts): held where it is typed, never sent (final wave D4). */
export const INEXACT: unique symbol = Symbol('inexact');

/**
 * Text typed where a number or text goes (a number-or-text field, a numeric tag): a number when it
 * reads as one (whole, if `integer`) that a double holds exactly; INEXACT when it reads as one a
 * double would round; else the text; '' is undefined.
 */
export function parseNumberOrText(text: string, integer: boolean): number | string | undefined | typeof INEXACT {
  if (text === '') return undefined;
  const s = text.trim();
  if (!DECIMAL_TEXT.test(s)) return text;
  const n = Number(s);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return text;
  return exactly(s, n) ? n : INEXACT;
}

// --- Fit -------------------------------------------------------------------------------------

const scalar = (v: unknown) => v === null || typeof v !== 'object';

/** Whether the node's field can show `v` as it is; a value that does not fit is shown as JSON instead. */
export function fits(node: Node, v: unknown): boolean {
  if (v === undefined) return true;
  switch (node.kind) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' || (node.orText === true && typeof v === 'string');
    case 'boolean':
      return typeof v === 'boolean';
    case 'enum':
      return scalar(v);
    case 'object':
    case 'map':
      return isObj(v);
    case 'array-scalar':
      // A tag holding a PEM private key would show it: such a list is shown as JSON, which veils it (fix round 1, R1).
      return Array.isArray(v) && v.every((x) => x !== undefined && scalar(x) && x !== null && fits(node.item, x) && !holdsPrivateKey(x));
    case 'array-object':
      return Array.isArray(v) && v.every((x) => fits(node.item, x));
    case 'variant':
      return isEmpty(v) || activeOption(node, v) >= 0;
    case 'json':
      return true;
  }
}

// --- Variants --------------------------------------------------------------------------------

/** The index of the first option `v` is a value of; -1 when none. */
export function activeOption(node: VariantNode, v: unknown): number {
  return node.options.findIndex((o) => o.matches(v));
}

/** Every key a part declares, its conditions' branches included. */
function declaredKeysOf(part: ObjectPart): Set<string> {
  const keys = new Set<string>();
  const collect = (p: ObjectPart) => {
    p.props.forEach((prop) => keys.add(prop.key));
    p.conditionals.forEach((c) => [c.then, c.else].forEach((x) => x && collect(x)));
  };
  collect(part);
  return keys;
}

function declaredKeys(node: Node): Set<string> {
  return node.kind === 'object' ? declaredKeysOf(node) : new Set<string>();
}

/**
 * The value after switching a variant from option `from` to option `to`: the keys both options
 * have are kept, the rest dropped; a discriminating key gets the new option's value. Values of
 * another type are dropped (undefined).
 */
export function switchOption(node: VariantNode, from: number, to: number, value: unknown): unknown {
  const target = node.options[to];
  const source = node.options[from];
  if (!target) return value;
  const kept: Obj = {};
  if (isObj(value) && source) {
    const shared = declaredKeys(target.node);
    const own = declaredKeys(source.node);
    for (const [k, v] of Object.entries(value)) if (shared.has(k) && own.has(k)) kept[k] = v;
  }
  if (target.discriminant) return { ...kept, [target.discriminant.key]: target.discriminant.value };
  return Object.keys(kept).length > 0 ? kept : undefined;
}

// --- Maps ------------------------------------------------------------------------------------

/** The kinds of scalar a node takes as typed text: which entries a key/value editor can show. */
function textKinds(node: Node): Set<string> {
  if (node.kind === 'string' && !node.secret && !node.multiline && !node.enum) return new Set(['string']);
  if (node.kind === 'number' && node.orText) return new Set(['string', 'number']);
  if (node.kind === 'json' && node.schema === ANY_SCHEMA) return new Set(['string']);
  if (node.kind === 'variant') {
    const kinds = node.options.flatMap((o) => (o.node.kind === 'number' ? ['number'] : [...textKinds(o.node)]));
    return kinds.includes('string') ? new Set(kinds) : new Set();
  }
  return new Set();
}

export type MapMode = 'kv' | 'rows' | 'json';

/** Whether a map edited as `mode` can show `value` (JSON shows anything). */
export function mapModeFits(node: MapNode, value: unknown, mode: MapMode): boolean {
  if (mode === 'json') return true;
  if (value !== undefined && !isObj(value)) return false;
  const entries = Object.values(value ?? {});
  if (mode === 'rows') return node.value.kind !== 'json' && entries.every((v) => fits(node.value, v));
  const kinds = textKinds(node.value);
  // An entry holding a PEM private key is never shown: rows, whose fields hide it (fix round 1, R1).
  return kinds.has('string') && entries.every((v) => kinds.has(jsonType(v) === 'integer' ? 'number' : jsonType(v)) && !holdsPrivateKey(v));
}

/**
 * How a map is edited: 'kv' (a key/value editor, when every entry is text the value schema takes),
 * 'rows' (a key and a field per entry), or 'json' (entries the value field cannot show).
 */
export function mapMode(node: MapNode, value: unknown): MapMode {
  if (mapModeFits(node, value, 'kv')) return 'kv';
  if (mapModeFits(node, value, 'rows')) return 'rows';
  return 'json';
}

// --- Objects ---------------------------------------------------------------------------------

export interface Shown {
  prop: Prop;
  required: boolean;
}

export interface Block {
  caption: string;
  fields: Shown[];
  /** The field the condition is about (policy), when the object shows it: the block goes after its row. */
  after?: string;
}

export interface ObjectView {
  /** The object's own fields, in display order. */
  fields: Shown[];
  /** Fields that conditions bring in, grouped under what brought them ("When policy is redis"). */
  blocks: Block[];
  /** "Set one of: count + time_window or rules", for the object's oneOf/anyOf of required sets. */
  hint?: string;
  /** Keys of the value the schema does not have. */
  unknown: string[];
  /** Keys of the value that only conditions which do not hold now would show. */
  hidden: string[];
  /** Keys of the value under a condition the browser can't evaluate (part of it is left to APISIX): neither shown nor said to be unused. */
  undecided: string[];
}

const list = (values: unknown[]) => values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');

/** What a condition says, for the caption of the fields it brings in. */
function caption(when: Obj | null, positive: boolean): string {
  if (!when) return t('sf.whenOther');
  const props = isObj(when.properties) ? Object.entries(when.properties) : [];
  const required = Array.isArray(when.required) ? when.required : [];
  if (props.length === 1 && props[0]) {
    const [key, sub] = props[0];
    if (isObj(sub)) {
      const values = 'const' in sub ? [sub.const] : Array.isArray(sub.enum) ? sub.enum : undefined;
      if (values) return t(positive ? 'sf.when' : 'sf.whenNot', { key, values: list(values) });
      if (positive && isObj(sub.contains) && 'const' in sub.contains) return t('sf.whenIncludes', { key, values: list([sub.contains.const]) });
    }
  }
  if (positive && props.length === 0 && required.length === 1 && typeof required[0] === 'string') return t('sf.whenSet', { key: required[0] });
  return t('sf.whenOther');
}

/** The one key a condition is about (`policy` in "policy is redis"), if it names exactly one. */
function subjectOf(when: Obj | null): string | undefined {
  if (!when) return undefined;
  const props = isObj(when.properties) ? Object.keys(when.properties) : [];
  const required = Array.isArray(when.required) ? when.required.filter((k): k is string => typeof k === 'string') : [];
  const keys = new Set([...props, ...required]);
  return keys.size === 1 ? [...keys][0] : undefined;
}

/**
 * Whether `when` holds for the object (with its fields' defaults filled in); undefined when
 * undecidable (both branches are shown, not required); 'unknown' when part of `when` is left to
 * APISIX (an unreadable pattern, schema/prepare.ts): the validator then applies neither `then` nor
 * `else`, and neither does the form.
 */
function holds(when: Obj | null, value: Obj): boolean | 'unknown' | undefined {
  if (!when) return undefined;
  const validate = validatorFor(when);
  if (validate && schemaGaps(when)) return 'unknown';
  return validate ? validate(value) : undefined;
}

function defaultsOf(props: Prop[]): Obj {
  const out: Obj = {};
  for (const p of props) if ('default' in p) out[p.key] = p.default;
  return out;
}

/** Every key the schema of the object knows, in any branch. */
function schemaKeys(node: ObjectNode): Set<string> {
  return declaredKeys(node);
}

function activeSet(sets: string[][], value: Obj): string[] {
  const has = (k: string) => value[k] !== undefined;
  return sets.find((s) => s.length > 0 && s.every(has)) ?? sets.find((s) => s.some(has)) ?? sets[0] ?? [];
}

/** The fields an object shows for `value`, which of them are required now, and what it does not show. */
export function objectView(node: ObjectNode, value: unknown): ObjectView {
  const v = isObj(value) ? value : {};
  const effective = { ...defaultsOf(node.props), ...v };
  const required = new Set<string>();
  const shown = new Set(node.props.map((p) => p.key));
  /** What the branches of a condition the browser can't evaluate declare. */
  const undecidedKeys = new Set<string>();
  const blocks: { caption: string; props: Prop[]; after?: string }[] = [];
  const hints: string[] = [];

  const apply = (part: ObjectPart, top: boolean) => {
    for (const alt of part.alternatives) {
      activeSet(alt.sets, v).forEach((k) => required.add(k));
      if (top && alt.sets.length > 1) {
        const sets = alt.sets.map((s) => s.join(t('sf.and'))).join(t('sf.or'));
        hints.push(t(alt.mode === 'oneOf' ? 'sf.oneOf' : 'sf.anyOf', { sets }));
      }
    }
    for (const [key, deps] of Object.entries(part.dependents)) if (v[key] !== undefined) deps.forEach((k) => required.add(k));
    for (const cond of part.conditionals) {
      const result = holds(cond.when, effective);
      if (result === 'unknown') {
        for (const branch of [cond.then, cond.else]) if (branch) declaredKeysOf(branch).forEach((k) => undecidedKeys.add(k));
        continue;
      }
      const branches: [ObjectPart | undefined, boolean][] =
        result === undefined ? [[cond.then, true], [cond.else, false]] : [[result ? cond.then : cond.else, result]];
      for (const [branch, positive] of branches) {
        if (!branch) continue;
        const fresh = branch.props.filter((p) => !shown.has(p.key));
        fresh.forEach((p) => shown.add(p.key));
        if (fresh.length > 0) {
          const after = subjectOf(cond.when);
          blocks.push({
            caption: result === undefined ? t('sf.whenOther') : caption(cond.when, positive),
            props: fresh,
            ...(after !== undefined && node.props.some((p) => p.key === after) ? { after } : {}),
          });
        }
        if (result !== undefined) branch.props.forEach((p) => p.required && required.add(p.key));
        apply(branch, false);
      }
    }
  };
  apply(node, true);

  const mark = (p: Prop): Shown => ({ prop: p, required: p.required || required.has(p.key) });
  const known = schemaKeys(node);
  const unknown: string[] = [];
  const hidden: string[] = [];
  const undecided: string[] = [];
  for (const key of Object.keys(v)) {
    if (shown.has(key)) continue;
    if (undecidedKeys.has(key)) undecided.push(key);
    else (known.has(key) ? hidden : unknown).push(key);
  }
  const view: ObjectView = {
    fields: node.props.map(mark),
    blocks: blocks.map((b) => ({ caption: b.caption, fields: b.props.map(mark), ...(b.after !== undefined ? { after: b.after } : {}) })),
    unknown,
    hidden,
    undecided,
  };
  if (hints.length > 0) view.hint = hints.join(' ');
  return view;
}

// --- Ids -------------------------------------------------------------------------------------

/** The DOM id of the field at `path` (dotted) in the form with this id prefix. */
export function fieldId(prefix: string, path: string): string {
  return `${prefix}-${path === '' ? 'root' : path.replace(/\s/g, '_')}`;
}

export const joinPath = (path: string, key: Key): string => (path === '' ? String(key) : `${path}.${String(key)}`);
