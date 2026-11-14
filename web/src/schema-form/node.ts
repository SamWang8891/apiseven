// The nodes the analysis produces (analyze.ts): what the schema form renders for each part of a schema.
import type { Obj } from '../api/types';

export interface Prop {
  key: string;
  node: Node;
  /** Required by the schema's own `required` list (conditions can add more; see model.ts). */
  required: boolean;
  title?: string;
  description?: string;
  /** Present only when the schema has a default (which may itself be falsy). */
  default?: unknown;
}

/** `oneOf`/`anyOf` lists of `required` sets on an object: "count + time_window, or rules". */
export interface Alternatives {
  mode: 'oneOf' | 'anyOf';
  sets: string[][];
}

/** `if`/`then`/`else`, or a dependency, or a discriminated `oneOf`: parts shown while `when` holds. */
export interface Conditional {
  /** A schema checked against the object (defaults applied); null when it cannot be decided. */
  when: Obj | null;
  then?: ObjectPart;
  else?: ObjectPart;
}

export interface ObjectPart {
  props: Prop[];
  alternatives: Alternatives[];
  /** `dependencies` in array form (or `{required}`): when the key is set, these are required too. */
  dependents: Record<string, string[]>;
  conditionals: Conditional[];
}

export interface StringNode {
  kind: 'string';
  enum?: string[];
  multiline: boolean;
  secret: boolean;
  /** Hosts, URIs, IDs, addresses, code: shown in monospace. */
  mono: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  /** What an `anyOf` of strings accepts, by title or format (ip-restriction: IPv4, IPv4/CIDR, …). */
  accepts?: string[];
}

export interface NumberNode {
  kind: 'number';
  integer: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
  /** Also takes a string (`["string","integer"]`, or `oneOf` integer | string): numeric text is emitted as a number. */
  orText?: boolean;
}

export interface ArrayBounds {
  minItems?: number;
  maxItems?: number;
  unique?: boolean;
}

export interface VariantOption {
  label: string;
  node: Node;
  /** Whether a value is of this option's form (by JSON type, a discriminating property, or its keys). */
  matches(v: unknown): boolean;
  /** For a discriminating property: the key and the value an option switched to writes. */
  discriminant?: { key: string; value: unknown };
}

export type Node =
  | StringNode
  | NumberNode
  | { kind: 'boolean' }
  /** An enum or const whose values are not all strings. */
  | { kind: 'enum'; values: unknown[] }
  | ({ kind: 'object'; allowsExtra: boolean; minProperties?: number } & ObjectPart)
  | ({ kind: 'array-scalar'; item: Node } & ArrayBounds)
  | ({ kind: 'array-object'; item: Node } & ArrayBounds)
  | { kind: 'map'; value: Node; patterns: string[]; minProperties?: number }
  /** `schema` is the whole combinator, for the JSON editor shown when a value matches no option. */
  | { kind: 'variant'; options: VariantOption[]; schema: Obj }
  | { kind: 'json'; schema: Obj };

export type ObjectNode = Extract<Node, { kind: 'object' }>;
export type MapNode = Extract<Node, { kind: 'map' }>;
export type VariantNode = Extract<Node, { kind: 'variant' }>;
export type JsonNode = Extract<Node, { kind: 'json' }>;
export type ArrayNode = Extract<Node, { kind: 'array-scalar' | 'array-object' }>;

/** The schema of a value that can be anything (a free-form object's entries, `true`). */
export const ANY_SCHEMA: Obj = {};

/** The JSON type of a value, with whole numbers as 'integer'. */
export function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Fields that take the full width of the form: groups, lists, maps, variants, JSON and multi-line text. */
export function isWide(node: Node): boolean {
  return (
    node.kind === 'object' ||
    node.kind === 'array-object' ||
    node.kind === 'map' ||
    node.kind === 'variant' ||
    node.kind === 'json' ||
    (node.kind === 'string' && node.multiline)
  );
}
