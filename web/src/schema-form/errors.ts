// Where an error shows: on the field at its path, or, when the form renders no field there (inside a
// JSON editor, a key the schema lacks, a list row that does not exist), on the nearest field above it
// that is rendered. '' is the form as a whole. Collapsed groups count as rendered: one that holds an
// error opens (ObjectField).
import { isObj } from '../schema/refs';
import type { Node } from './analyze';
import { activeOption, fits, isEmpty, mapMode, objectView } from './model';

export interface FormError {
  /** Dotted, relative to the form's value: '' (the whole), 'redis.host', 'rules.0.match'. */
  path: string;
  message: string;
}

/** The node and value one step down, at `seg`, if the form renders a field there. */
function step(node: Node, value: unknown, seg: string): { node: Node; value: unknown } | undefined {
  if (!fits(node, value)) return undefined;
  switch (node.kind) {
    case 'object': {
      const view = objectView(node, value);
      const shown = [...view.fields, ...view.blocks.flatMap((b) => b.fields)].find((f) => f.prop.key === seg);
      return shown ? { node: shown.prop.node, value: isObj(value) ? value[seg] : undefined } : undefined;
    }
    case 'array-object': {
      const index = Number(seg);
      if (!Array.isArray(value) || !Number.isInteger(index) || index < 0 || index >= value.length) return undefined;
      return { node: node.item, value: value[index] };
    }
    case 'map':
      return mapMode(node, value) === 'rows' && isObj(value) && seg in value ? { node: node.value, value: value[seg] } : undefined;
    case 'variant': {
      // The option's fields sit at the variant's own path.
      const index = isEmpty(value) ? 0 : activeOption(node, value);
      const option = node.options[index];
      return option ? step(option.node, value, seg) : undefined;
    }
    default:
      return undefined;
  }
}

/** The path of the field that shows an error at `path`. */
export function landing(node: Node, value: unknown, path: string): string {
  const out: string[] = [];
  let at = { node, value };
  for (const seg of path === '' ? [] : path.split('.')) {
    const next = step(at.node, at.value, seg);
    if (!next) break;
    out.push(seg);
    at = next;
  }
  return out.join('.');
}

/** Messages by the path of the rendered field that shows them. */
export function placeErrors(node: Node, value: unknown, errors: FormError[]): Map<string, string[]> {
  const placed = new Map<string, string[]>();
  for (const error of errors) {
    const at = landing(node, value, error.path);
    placed.set(at, [...(placed.get(at) ?? []), error.message]);
  }
  return placed;
}
