// JSON Schema support for the CodeMirror JSON editor: Ajv validation mapped onto the syntax tree
// (lint), and property-name / enum completion from the schema at the cursor.
import {
  insertCompletionText,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { Obj } from '../../api/types';

type Segment = string | number;

const VALUE_NODES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null']);

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------
// Syntax tree helpers (Lezer JSON: JsonText > value; Object > Property > PropertyName ":" value)

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

const values = (node: SyntaxNode): SyntaxNode[] => children(node).filter((c) => VALUE_NODES.has(c.name));

function keyOf(state: EditorState, property: SyntaxNode): string | undefined {
  const name = property.getChild('PropertyName');
  if (!name) return undefined;
  try {
    const key: unknown = JSON.parse(state.sliceDoc(name.from, name.to));
    return typeof key === 'string' ? key : undefined;
  } catch {
    return undefined;
  }
}

/** The property's value node (after the colon), if it has one. */
const valueOf = (property: SyntaxNode): SyntaxNode | undefined => values(property)[0];

/** The property named `key`; the last one wins, as in JSON.parse. */
function propertyNamed(state: EditorState, object: SyntaxNode, key: string): SyntaxNode | undefined {
  return object.getChildren('Property').findLast((p) => keyOf(state, p) === key);
}

/** The JSON path from the document root to `node`. */
function pathTo(state: EditorState, node: SyntaxNode): Segment[] {
  const path: Segment[] = [];
  for (let cur = node; cur.parent; cur = cur.parent) {
    const parent = cur.parent;
    if (parent.name === 'Property' && cur.name !== 'PropertyName') {
      const key = keyOf(state, parent);
      if (key !== undefined) path.unshift(key);
    } else if (parent.name === 'Array') {
      path.unshift(values(parent).filter((v) => v.from < cur.from).length);
    }
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// Lint

const validators = new WeakMap<Obj, ValidateFunction | null>();

/** Compiles once per schema object; null when Ajv cannot compile it (the editor then only checks syntax). */
function validatorFor(schema: Obj): ValidateFunction | null {
  let validate = validators.get(schema);
  if (validate === undefined) {
    const copy = { ...schema };
    delete copy.$schema; // APISIX schemas are draft-07 compatible; a draft-04 URI here would not resolve.
    try {
      validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(copy);
    } catch {
      validate = null;
    }
    validators.set(schema, validate);
  }
  return validate;
}

/** Drops the per-branch errors under a failed anyOf/oneOf, keeping the summary error. */
function withoutBranchNoise(errors: ErrorObject[]): ErrorObject[] {
  const branches = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf').map((e) => `${e.schemaPath}/`);
  return errors.filter((e) => !branches.some((b) => e.schemaPath.startsWith(b)));
}

function describe(error: ErrorObject): string {
  const where = error.instancePath.slice(1).replace(/~1/g, '/').replace(/~0/g, '~');
  const params = error.params as Record<string, unknown>;
  let message = error.message ?? error.keyword;
  if (error.keyword === 'additionalProperties') message = `must NOT have additional property "${String(params.additionalProperty)}"`;
  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) {
    message = `must be one of ${params.allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  return where ? `${where}: ${message}` : message;
}

/** The document range an Ajv error points at. */
function rangeOf(state: EditorState, root: SyntaxNode, error: ErrorObject): { from: number; to: number } {
  let node = root;
  for (const raw of error.instancePath.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const next =
      node.name === 'Object'
        ? valueOf(propertyNamed(state, node, seg) ?? node)
        : node.name === 'Array'
          ? values(node)[Number(seg)]
          : undefined;
    if (!next || next === node) break;
    node = next;
  }
  const params = error.params as Record<string, unknown>;
  if (error.keyword === 'additionalProperties' && node.name === 'Object' && typeof params.additionalProperty === 'string') {
    const name = propertyNamed(state, node, params.additionalProperty)?.getChild('PropertyName');
    if (name) return { from: name.from, to: name.to };
  }
  if (node.name === 'Object' || node.name === 'Array') {
    // Marking a whole object would underline pages of text: mark its key, or its opening bracket.
    const name = node.parent?.name === 'Property' && error.keyword !== 'required' ? node.parent.getChild('PropertyName') : null;
    return name ? { from: name.from, to: name.to } : { from: node.from, to: node.from + 1 };
  }
  return { from: node.from, to: node.to };
}

/** Schema violations of the document, positioned on the offending text. Empty if the text is not JSON. */
export function schemaDiagnostics(state: EditorState, schema: Obj): Diagnostic[] {
  const validate = validatorFor(schema);
  if (!validate) return [];
  let data: unknown;
  try {
    data = JSON.parse(state.doc.toString());
  } catch {
    return [];
  }
  if (validate(data)) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
  const root = tree.topNode.firstChild;
  if (!root) return [];
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const error of withoutBranchNoise(validate.errors ?? [])) {
    const { from, to } = rangeOf(state, root, error);
    const message = describe(error);
    const id = `${from}:${to}:${message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ from, to, severity: 'error', source: 'schema', message });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Completion

function resolveRef(root: Obj, ref: string): Obj | undefined {
  if (!ref.startsWith('#')) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const seg = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    cur = isObj(cur) ? cur[seg] : undefined;
  }
  return isObj(cur) ? cur : undefined;
}

/** The schema plus everything it pulls in through $ref and allOf/anyOf/oneOf/then/else. */
function expand(root: Obj, schema: unknown, depth = 0): Obj[] {
  if (!isObj(schema) || depth > 10) return [];
  if (typeof schema.$ref === 'string') return expand(root, resolveRef(root, schema.$ref), depth + 1);
  const out = [schema];
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const list = schema[key];
    if (Array.isArray(list)) for (const sub of list) out.push(...expand(root, sub, depth + 1));
  }
  for (const key of ['then', 'else']) out.push(...expand(root, schema[key], depth + 1));
  return out;
}

function childSchemas(root: Obj, schemas: Obj[], seg: Segment): Obj[] {
  const out: Obj[] = [];
  for (const s of schemas) {
    if (typeof seg === 'number') {
      const items = s.items;
      const item: unknown = Array.isArray(items) ? items[seg] : items;
      if (item !== undefined) out.push(...expand(root, item));
      continue;
    }
    const props = s.properties;
    if (isObj(props) && props[seg] !== undefined) {
      out.push(...expand(root, props[seg]));
      continue;
    }
    const patterns = s.patternProperties;
    const matched = isObj(patterns) ? Object.entries(patterns).filter(([p]) => safeTest(p, seg)) : [];
    if (matched.length > 0) for (const [, sub] of matched) out.push(...expand(root, sub));
    else if (isObj(s.additionalProperties)) out.push(...expand(root, s.additionalProperties));
  }
  return out;
}

function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(text);
  } catch {
    return false;
  }
}

function schemasAt(schema: Obj, path: Segment[]): Obj[] {
  let current = expand(schema, schema);
  for (const seg of path) current = childSchemas(schema, current, seg);
  return current;
}

function typeLabel(schemas: Obj[]): string | undefined {
  const types = schemas.flatMap((s): unknown[] => (Array.isArray(s.type) ? s.type : s.type === undefined ? [] : [s.type])).map(String);
  return types.length ? [...new Set(types)].join(' | ') : undefined;
}

function descriptionOf(schemas: Obj[]): string | undefined {
  return schemas.map((s) => s.description).find((d): d is string => typeof d === 'string');
}

/**
 * An `apply` that writes `text` and also replaces the rest of the token after the cursor (`tail`
 * matches it), adding `suffix(after)` when the text after the token calls for it. The completion's
 * `to` must stay at the cursor, since @codemirror/autocomplete filters on the text from `from` to `to`.
 */
function applyThrough(text: string, tail: RegExp, suffix: (after: string) => string = () => '') {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const end = to + (tail.exec(view.state.sliceDoc(to, to + 500))?.[0].length ?? 0);
    const insert = text + suffix(view.state.sliceDoc(end, end + 40));
    view.dispatch(insertCompletionText(view.state, insert, from, end));
  };
}

/** The rest of a key after the cursor: name characters and the closing quote, if there is one. */
const KEY_TAIL = /^[^"\s,:{}[\]\\]*"?/;
/** The rest of a literal value after the cursor. */
const STRING_TAIL = /^[^"\n]*"/;
const BARE_TAIL = /^[\w.+-]*/;

const colonUnlessPresent = (after: string) => (/^\s*:/.test(after) ? '' : ': ');

function propertyOptions(schema: Obj, objectPath: Segment[], taken: Set<string>, opened: boolean): Completion[] {
  const parents = schemasAt(schema, objectPath);
  const names: string[] = [];
  for (const s of parents) {
    if (isObj(s.properties)) for (const name of Object.keys(s.properties)) if (!names.includes(name)) names.push(name);
  }
  return names
    .filter((name) => !taken.has(name))
    .map((name) => {
      const sub = childSchemas(schema, parents, name);
      const quoted = JSON.stringify(name);
      return {
        label: name,
        type: 'property',
        detail: typeLabel(sub),
        info: descriptionOf(sub),
        // Typed after an opening quote: write the name and close it; bare: write the whole key.
        apply: applyThrough(opened ? quoted.slice(1) : quoted, opened ? KEY_TAIL : BARE_TAIL, colonUnlessPresent),
      };
    });
}

function valueOptions(schema: Obj, path: Segment[]): Completion[] {
  const labels: string[] = [];
  const add = (v: unknown) => {
    const label = JSON.stringify(v);
    if (!labels.includes(label)) labels.push(label);
  };
  for (const s of schemasAt(schema, path)) {
    if (Array.isArray(s.enum)) s.enum.forEach(add);
    if ('const' in s) add(s.const);
    if (s.type === 'boolean' || (Array.isArray(s.type) && s.type.includes('boolean'))) [true, false].forEach(add);
  }
  return labels.map((label) => ({ label, type: 'constant', apply: applyThrough(label, label.startsWith('"') ? STRING_TAIL : BARE_TAIL) }));
}

/** Where the cursor is: naming a property of an object, or giving a value. */
type Spot =
  | { mode: 'key'; object: SyntaxNode; editing?: SyntaxNode }
  | { mode: 'value'; path: Segment[]; replacing?: SyntaxNode };

function spotAt(state: EditorState, pos: number): Spot | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node && !VALUE_NODES.has(node.name) && node.name !== 'Property' && node.name !== 'PropertyName') node = node.parent;
  if (!node) return undefined;

  if (node.name === 'PropertyName') {
    const object = node.parent?.parent;
    return object ? { mode: 'key', object, editing: node } : undefined;
  }
  if (node.name === 'Property') {
    const colon = children(node).find((c) => c.name === ':');
    if (colon && pos >= colon.to) return { mode: 'value', path: [...pathTo(state, node), keyOf(state, node) ?? ''] };
    const object = node.parent;
    return object ? { mode: 'key', object } : undefined;
  }
  if (node.name === 'Object') {
    if (pos <= node.from) return undefined;
    // Inside an object between properties: a property whose colon is behind the cursor and has no value yet.
    const open = node.getChildren('Property').find((p) => {
      const colon = children(p).find((c) => c.name === ':');
      return colon && colon.to <= pos && !valueOf(p) && p.to >= pos - 1;
    });
    if (open) return { mode: 'value', path: [...pathTo(state, open), keyOf(state, open) ?? ''] };
    return { mode: 'key', object: node };
  }
  if (node.name === 'Array') return { mode: 'value', path: [...pathTo(state, node), values(node).filter((v) => v.to <= pos).length] };
  // A literal: a value of a property or array item, or a stray string where a key belongs.
  if (node.name === 'String' && node.parent?.name === 'Object') return { mode: 'key', object: node.parent, editing: node };
  return { mode: 'value', path: pathTo(state, node), replacing: node };
}

/** Completes property names (minus those present) and enum/const/boolean values from the schema. */
export function schemaCompletionSource(schema: Obj): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const spot = spotAt(ctx.state, ctx.pos);
    if (!spot) return null;
    const word = ctx.matchBefore(/"?[\w$@.-]*/);
    if (!ctx.explicit && (!word || word.from === word.to)) return null;

    if (spot.mode === 'key') {
      const taken = new Set(
        spot.object
          .getChildren('Property')
          .filter((p) => p.getChild('PropertyName') !== spot.editing)
          .map((p) => keyOf(ctx.state, p))
          .filter((k): k is string => k !== undefined),
      );
      // Filtering starts after any opening quote, so typed `"po` matches the label `policy`.
      const opened = spot.editing !== undefined || word?.text.startsWith('"') === true;
      const from = spot.editing ? spot.editing.from + 1 : (word?.from ?? ctx.pos) + (opened ? 1 : 0);
      const options = propertyOptions(schema, pathTo(ctx.state, spot.object), taken, opened);
      return options.length > 0 ? { from, options, validFor: /^[\w$@.-]*$/ } : null;
    }

    // Value labels are JSON (`"chash"`, `true`), so filtering starts at the literal's first character.
    const options = valueOptions(schema, spot.path);
    if (options.length === 0) return null;
    const from = spot.replacing ? spot.replacing.from : (word?.from ?? ctx.pos);
    return { from, options, validFor: /^"?[\w$@.-]*$/ };
  };
}
