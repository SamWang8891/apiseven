import type { Node, Prop } from '../analyze';
import type { Key } from '../model';

/** What every field component gets. Fields are memoised: all of these stay stable between edits. */
export interface FieldProps<N extends Node = Node> {
  node: N;
  value: unknown;
  /** The key or index the field writes in its parent; passed back to onChange. */
  name: Key;
  /** Dotted path from the form's value: ids and errors. */
  path: string;
  /** One stable callback per parent; `undefined` deletes the key. */
  onChange: (name: Key, value: unknown) => void;
  /** The property shown (label, help, default); absent for list items and map values. */
  prop?: Prop;
  required: boolean;
  /** The accessible name of a field shown without a label (a list row, a map value). */
  ariaLabel?: string;
}
