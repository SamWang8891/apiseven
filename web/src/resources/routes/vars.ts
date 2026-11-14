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
  value: string | number | string[];
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
    // Items are compared with == and no tonumber, so 1 and "1" differ; tags can't show which: JSON.
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return { variable, not: raw.length === 4, op: lower, value };
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

/**
 * A row of the editor. `last` is the condition the row last put in the value: the stored one until
 * the row is edited (`touched`), then each good one it makes. While the row holds input it can't
 * emit (a value without a variable, text that is not a number), the value keeps `last` in its place,
 * as a kit field keeps the value it last emitted: leaving the input unfinished never deletes a condition.
 */
export interface Row {
  id: number;
  variable: string;
  not: boolean;
  op: Operator;
  /** The value of a scalar operator, as typed. */
  text: string;
  /** The values of a list operator (strings only: a list with a number stays JSON). */
  list: string[];
  /** The value was a number: kept a number while the text is one (only <, <=, > and >= convert with tonumber). */
  wasNumber: boolean;
  /** Edited by the user: it emits what it shows, no longer the stored condition as written. */
  touched: boolean;
  last?: unknown[];
}

let lastRowId = 0;

export function blankRow(): Row {
  return { id: ++lastRowId, variable: '', not: false, op: '==', text: '', list: [], wasNumber: false, touched: true };
}

/** The rows for a representable value (undefined → none). */
export function rowsOf(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    const c = conditionOf(raw);
    if (!c) return [];
    const list = Array.isArray(c.value) ? c.value.map(String) : LISTS.has(c.op) ? [String(c.value)] : [];
    const text = Array.isArray(c.value) || LISTS.has(c.op) ? '' : String(c.value);
    return [{ id: ++lastRowId, variable: c.variable, not: c.not, op: c.op, text, list, wasNumber: typeof c.value === 'number', touched: false, last: raw as unknown[] }];
  });
}

/** A row holds nothing worth keeping: no variable, no value, not negated. */
export const isBlank = (row: Row): boolean => row.variable === '' && row.text === '' && row.list.length === 0 && !row.not;

/**
 * What a row shows makes: a condition, nothing (a blank row), or input it can't emit (held: shown,
 * and the value keeps the row's `last` condition meanwhile).
 */
export type RowResult = { kind: 'blank' } | { kind: 'ok'; condition: unknown[] } | { kind: 'held'; message: string; on: 'variable' | 'value' };

export function resultOf(row: Row, n: number): RowResult {
  if (!row.touched && row.last) return { kind: 'ok', condition: row.last };
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
  } else if (row.wasNumber && isNumeric(row.text)) {
    // ==, ~= and has compare without tonumber, so 7 and "7" differ: a number stays one.
    value = Number(row.text);
  } else {
    value = row.text;
  }
  return { kind: 'ok', condition: row.not ? [row.variable, '!', row.op, value] : [row.variable, row.op, value] };
}

/**
 * The value the rows make: their conditions, in order (a row that holds input contributes its last
 * good condition, if it had one); undefined when there are none (removes `vars`).
 */
export function valueOfRows(rows: Row[]): unknown[] | undefined {
  const conditions = rows.flatMap((row, i) => {
    const result = resultOf(row, i + 1);
    if (result.kind === 'ok') return [result.condition];
    return result.kind === 'held' && row.last ? [row.last] : [];
  });
  return conditions.length > 0 ? conditions : undefined;
}

/** The rows that hold input they can't emit, as one message; undefined when none do. */
export function heldMessage(rows: Row[]): string | undefined {
  const messages = rows.flatMap((row, i) => {
    const result = resultOf(row, i + 1);
    return result.kind === 'held' ? [result.message] : [];
  });
  return messages.length > 0 ? messages.join('; ') : undefined;
}

/**
 * Rows for a value that came from outside: its own rows, with the rows that hold input kept (never
 * dropped): in the place of their last condition when the value still has it, else at the end.
 * Unchanged when the rows already make that value.
 */
export function rowsFor(value: unknown, rows: Row[]): Row[] {
  if (deepEqual(valueOfRows(rows), value)) return rows;
  const next = rowsOf(value);
  const replaced = new Set<number>();
  const extra: Row[] = [];
  rows.forEach((row, i) => {
    if (resultOf(row, i + 1).kind !== 'held') return;
    const at = next.findIndex((fresh, j) => !replaced.has(j) && row.last !== undefined && deepEqual(fresh.last, row.last));
    if (at < 0) extra.push(row);
    else {
      replaced.add(at);
      next[at] = row;
    }
  });
  return [...next, ...extra];
}

/** A row changed by the user: it emits what it shows from now on; a good condition it makes becomes its `last`. */
export function edited(row: Row, patch: Partial<Omit<Row, 'id' | 'touched' | 'last'>>): Row {
  let next: Row = { ...row, ...patch, touched: true };
  // Switching between a list operator and a scalar one carries the value across.
  if (patch.op !== undefined && LISTS.has(patch.op) !== LISTS.has(row.op)) {
    if (LISTS.has(patch.op) && next.list.length === 0 && next.text.trim() !== '') next = { ...next, list: [next.text.trim()], text: '' };
    else if (!LISTS.has(patch.op) && next.text === '' && next.list.length > 0) next = { ...next, text: next.list[0] ?? '', list: [] };
  }
  const result = resultOf(next, 0);
  if (result.kind === 'ok') return { ...next, last: result.condition };
  // A row emptied on purpose shows nothing, so it puts nothing in the value.
  return result.kind === 'blank' ? { ...next, last: undefined } : next;
}

/** A condition as one line for the locked view: `arg_id == "1"`, `remote_addr not ipmatch ["10.0.0.0/8"]`, and what the operator means. */
export function describeCondition(c: Condition): { variable: string; op: string; meaning: string; value: string } {
  return { variable: c.variable, op: c.not ? `${t('rt.vars.not')} ${c.op}` : c.op, meaning: t(`rt.vars.op.${c.op}`), value: JSON.stringify(c.value) };
}
