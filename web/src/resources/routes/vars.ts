// A route's `vars`: conditions in lua-resty-expr's form (resty/expr/v1.lua, as APISIX 3.20 ships
// it), all of which must hold for the route to match. The rows editor handles the common case, a
// flat list of `[variable, operator, value]` or `[variable, "!", operator, value]`; anything else
// (AND/OR groups, the two-element shorthand, values of an unexpected type) stays JSON.
import { deepEqual } from '../../editor/draft';
import { t } from '../../i18n';

/** compare_funcs in resty/expr/v1.lua. APISIX lower-cases the operator, so "IN" is "in". */
export const OPERATORS = ['==', '~=', '>', '>=', '<', '<=', '~~', '~*', 'in', 'has', 'ipmatch'] as const;
export type Operator = (typeof OPERATORS)[number];

/** Operators that convert both sides with tonumber. */
export const NUMERIC: ReadonlySet<string> = new Set(['>', '>=', '<', '<=']);
/** Operators whose value is a list: `in` (one of), `ipmatch` (addresses or CIDR ranges; one may be a string). */
export const LISTS: ReadonlySet<string> = new Set(['in', 'ipmatch']);
/** logic_ops: a list starting with one of these is a group, not a condition. */
const LOGIC = new Set(['AND', 'OR', '!AND', '!OR']);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const isNumeric = (text: string): boolean => NUMBER.test(text.trim()) && Number.isFinite(Number(text));
const isScalar = (v: unknown): v is string | number => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const isOperator = (op: string): op is Operator => (OPERATORS as readonly string[]).includes(op);

/** One condition as the rows show it. */
export interface Condition {
  variable: string;
  not: boolean;
  op: Operator;
  value: string | number | (string | number)[];
}

/** The condition `raw` is, when the rows can show it; undefined for anything else. */
export function conditionOf(raw: unknown): Condition | undefined {
  if (!Array.isArray(raw) || (raw.length !== 3 && raw.length !== 4)) return undefined;
  const [variable] = raw as unknown[];
  if (typeof variable !== 'string' || LOGIC.has(variable.toUpperCase())) return undefined;
  if (raw.length === 4 && raw[1] !== '!') return undefined;
  const items = raw as unknown[];
  const op = items[raw.length - 2];
  const value = items[raw.length - 1];
  if (typeof op !== 'string') return undefined;
  const lower = op.toLowerCase();
  if (!isOperator(lower)) return undefined;
  if (LISTS.has(lower)) {
    if (Array.isArray(value) && value.every(isScalar)) return { variable, not: raw.length === 4, op: lower, value };
    // ipmatch also takes one address as a string.
    if (lower === 'ipmatch' && typeof value === 'string') return { variable, not: raw.length === 4, op: lower, value };
    return undefined;
  }
  return isScalar(value) ? { variable, not: raw.length === 4, op: lower, value } : undefined;
}

/** Whether the rows can show `value`: nothing, or a flat list of conditions. */
export function representable(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((c) => conditionOf(c) !== undefined));
}

/** A row of the editor. `raw` is the condition it was made from, emitted as it is until the row is edited. */
export interface Row {
  id: number;
  variable: string;
  not: boolean;
  op: Operator;
  /** The value of a scalar operator, as typed. */
  text: string;
  /** The values of a list operator. */
  list: string[];
  /** The value was a number (== and ~= compare as numbers then): kept a number while the text is one. */
  wasNumber: boolean;
  raw?: unknown[];
}

let lastRowId = 0;

export function blankRow(): Row {
  return { id: ++lastRowId, variable: '', not: false, op: '==', text: '', list: [], wasNumber: false };
}

/** The rows for a representable value (undefined → none). */
export function rowsOf(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    const c = conditionOf(raw);
    if (!c) return [];
    const list = Array.isArray(c.value) ? c.value.map(String) : LISTS.has(c.op) ? [String(c.value)] : [];
    const text = Array.isArray(c.value) || LISTS.has(c.op) ? '' : String(c.value);
    return [{ id: ++lastRowId, variable: c.variable, not: c.not, op: c.op, text, list, wasNumber: typeof c.value === 'number', raw: raw as unknown[] }];
  });
}

/** A row holds nothing worth keeping: no variable, no value, not negated. */
export const isBlank = (row: Row): boolean => row.variable === '' && row.text === '' && row.list.length === 0 && !row.not;

/** What a row emits, or why it can't (it is then held: shown, but not in the value). Blank rows emit nothing. */
export type RowResult = { kind: 'blank' } | { kind: 'ok'; condition: unknown[] } | { kind: 'held'; message: string; on: 'variable' | 'value' };

export function resultOf(row: Row, n: number): RowResult {
  if (row.raw) return { kind: 'ok', condition: row.raw };
  if (isBlank(row)) return { kind: 'blank' };
  if (row.variable.trim() === '') return { kind: 'held', message: t('rt.vars.held.noVariable', { n }), on: 'variable' };
  let value: unknown;
  if (LISTS.has(row.op)) {
    if (row.op === 'ipmatch' && row.list.length === 0) return { kind: 'held', message: t('rt.vars.held.noAddress', { n }), on: 'value' };
    value = [...row.list];
  } else if (NUMERIC.has(row.op)) {
    if (row.text.trim() === '') return { kind: 'held', message: t('rt.vars.held.noNumber', { n }), on: 'value' };
    if (!isNumeric(row.text)) return { kind: 'held', message: t('rt.vars.held.notNumber', { n, text: row.text.trim() }), on: 'value' };
    value = Number(row.text);
  } else if ((row.op === '==' || row.op === '~=') && row.wasNumber && isNumeric(row.text)) {
    value = Number(row.text);
  } else {
    value = row.text;
  }
  return { kind: 'ok', condition: row.not ? [row.variable, '!', row.op, value] : [row.variable, row.op, value] };
}

/** The value the rows make: their conditions, in order; undefined when there are none (removes `vars`). */
export function valueOfRows(rows: Row[]): unknown[] | undefined {
  const conditions = rows.flatMap((row, i) => {
    const result = resultOf(row, i + 1);
    return result.kind === 'ok' ? [result.condition] : [];
  });
  return conditions.length > 0 ? conditions : undefined;
}

/** The rows that hold something the value leaves out (held), as one message; undefined when none do. */
export function heldMessage(rows: Row[]): string | undefined {
  const messages = rows.flatMap((row, i) => {
    const result = resultOf(row, i + 1);
    return result.kind === 'held' ? [result.message] : [];
  });
  return messages.length > 0 ? messages.join('; ') : undefined;
}

/**
 * Rows for a value that came from outside: its own rows, then the rows that hold something it left
 * out (never dropped). Unchanged when the rows already make that value.
 */
export function rowsFor(value: unknown, rows: Row[]): Row[] {
  if (deepEqual(valueOfRows(rows), value)) return rows;
  const held = rows.filter((row, i) => resultOf(row, i + 1).kind === 'held');
  return [...rowsOf(value), ...held];
}

/** A row changed by the user: it no longer emits its original condition, but what it shows. */
export function edited(row: Row, patch: Partial<Omit<Row, 'id' | 'raw'>>): Row {
  const next: Row = { ...row, ...patch, raw: undefined };
  // Switching between a list operator and a scalar one carries the value across.
  if (patch.op !== undefined && LISTS.has(patch.op) !== LISTS.has(row.op)) {
    if (LISTS.has(patch.op) && next.list.length === 0 && next.text.trim() !== '') return { ...next, list: [next.text.trim()], text: '' };
    if (!LISTS.has(patch.op) && next.text === '' && next.list.length > 0) return { ...next, text: next.list[0] ?? '', list: [] };
  }
  return next;
}

/** A condition as one line for the locked view: `arg_id == "1"`, `remote_addr not ipmatch ["10.0.0.0/8"]`, and what the operator means. */
export function describeCondition(c: Condition): { variable: string; op: string; meaning: string; value: string } {
  return { variable: c.variable, op: c.not ? `${t('rt.vars.not')} ${c.op}` : c.op, meaning: t(`rt.vars.op.${c.op}`), value: JSON.stringify(c.value) };
}
