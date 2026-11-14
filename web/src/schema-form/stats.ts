// How much of a schema the form shows as a JSON editor instead of fields (the Playground's table and
// the fallback-ratio test).
import type { Obj } from '../api/types';
import { isObj } from '../schema/refs';
import { analyze, ANY_SCHEMA, type Node, type ObjectPart } from './analyze';

export interface FallbackStats {
  /** Top-level properties: the root's own, plus those its conditions and alternatives add. */
  props: number;
  /** The top-level ones that are JSON editors. */
  json: string[];
  /** Every JSON editor below the top level, as a dotted path (`[]` for array items, `*` for map values). */
  nested: string[];
}

function partProps(part: ObjectPart, out: Map<string, Node>) {
  for (const prop of part.props) if (!out.has(prop.key)) out.set(prop.key, prop.node);
  for (const cond of part.conditionals) {
    if (cond.then) partProps(cond.then, out);
    if (cond.else) partProps(cond.else, out);
  }
}

function walk(node: Node, path: string, out: string[], depth = 0) {
  if (depth > 40) return;
  switch (node.kind) {
    case 'json':
      out.push(path);
      return;
    case 'object': {
      const props = new Map<string, Node>();
      partProps(node, props);
      for (const [key, child] of props) walk(child, path ? `${path}.${key}` : key, out, depth + 1);
      return;
    }
    case 'array-scalar':
    case 'array-object':
      walk(node.item, `${path}[]`, out, depth + 1);
      return;
    case 'map':
      // A map of anything (a free-form object) shows its string entries as key/value rows: not a fallback.
      if (!(node.value.kind === 'json' && node.value.schema === ANY_SCHEMA)) walk(node.value, `${path}.*`, out, depth + 1);
      return;
    case 'variant':
      node.options.forEach((o) => walk(o.node, `${path}<${o.label}>`, out, depth + 1));
      return;
    default:
  }
}

export function fallbackStats(schema: Obj): FallbackStats {
  const root = analyze(schema);
  if (root.kind !== 'object') {
    const keys = isObj(schema.properties) ? Object.keys(schema.properties) : [''];
    return { props: keys.length, json: root.kind === 'json' ? keys : [], nested: [] };
  }
  const props = new Map<string, Node>();
  partProps(root, props);
  const json: string[] = [];
  const nested: string[] = [];
  for (const [key, node] of props) {
    if (node.kind === 'json') json.push(key);
    else walk(node, key, nested);
  }
  return { props: props.size, json, nested };
}
