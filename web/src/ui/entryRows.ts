// Rows of key → value that edit a map (KeyValueInput; the schema form's map rows). A row's entry goes
// into the map while its key is good. While a row holds input it can't put there (no key, a key
// another row has, a key or value the rules refuse), the map keeps the row's last committed entry,
// in its place: an unfinished rename never deletes an entry, and "Discard and switch" leaves the map
// as it was. A row commits its entry when it is left while good (blur; Save leaves the field first),
// so the keys typed on the way to a taken one ("e", "en" before "env") never become the kept entry.
// A row emptied completely (no key, no value) is a removal; so is its Remove button.

/** JSON values compared as data (a value from outside is a new object with the same content). */
const sameValue = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

export interface EntryRow<V> {
  id: number;
  key: string;
  value: V;
  /** The entry this row last committed to the map: the stored one, then each good one it is left with. */
  last?: { key: string; value: V };
}

export interface EntryRules<V> {
  /** Why a key another row has is refused (a message, or a marker the caller turns into one). */
  duplicate: (key: string) => string;
  /** Why a changed key is refused besides that, if it is (a key pattern). A row's own unchanged key never is. */
  refuseKey?: (key: string) => string | undefined;
  /** Why the row's value keeps it out of the map, if it does (no value). */
  refuseValue?: (row: EntryRow<V>) => string | undefined;
  /** A row with nothing in it (no key, no value): it holds nothing, and emptied, it removes its entry. */
  blank: (row: EntryRow<V>) => boolean;
}

/**
 * Why each row's current entry stays out of the map ('' for no key, else the rules' message), or
 * undefined when it goes in. A key is taken by the row whose last entry has it (a held row keeps
 * its entry in the map) and by a row above that puts it there now. A row's own unchanged key is
 * never refused: stored data the key rules refuse stays until someone changes it.
 */
export function entryRefusals<V>(rows: EntryRow<V>[], rules: EntryRules<V>): (string | undefined)[] {
  const owner = new Map<string, number>();
  for (const row of rows) if (row.last && !owner.has(row.last.key)) owner.set(row.last.key, row.id);
  const used = new Set<string>();
  return rows.map((row) => {
    const own = row.last !== undefined && row.key === row.last.key;
    let refusal: string | undefined;
    if (used.has(row.key) || (owner.has(row.key) && owner.get(row.key) !== row.id)) refusal = rules.duplicate(row.key);
    else if (!own) refusal = row.key === '' ? '' : rules.refuseKey?.(row.key);
    refusal ??= rules.refuseValue?.(row);
    if (refusal === undefined) used.add(row.key);
    return refusal;
  });
}

/** Whether a row holds input it can't put in the map (refused, and not blank). */
export const entryHeld = <V>(row: EntryRow<V>, refusal: string | undefined, rules: EntryRules<V>): boolean => refusal !== undefined && !rules.blank(row);

/** The map the rows make, in row order: each row's entry, or while it holds input, its last good one. */
export function entriesOf<V>(rows: EntryRow<V>[], rules: EntryRules<V>): Record<string, V> {
  const refused = entryRefusals(rows, rules);
  const map: Record<string, V> = {};
  rows.forEach((row, i) => {
    const refusal = refused[i];
    if (refusal === undefined) map[row.key] = row.value;
    else if (entryHeld(row, refusal, rules) && row.last) map[row.last.key] = row.last.value;
  });
  return map;
}

/** The rows with row `id` committed: its entry recorded as its `last` when it is good (left while good). */
export function commitEntry<V>(rows: EntryRow<V>[], id: number, rules: EntryRules<V>): EntryRow<V>[] {
  const refused = entryRefusals(rows, rules);
  const at = rows.findIndex((row) => row.id === id);
  const row = rows[at];
  if (!row || refused[at] !== undefined || (row.last && row.last.key === row.key && sameValue(row.last.value, row.value))) return rows;
  return rows.map((r) => (r.id === id ? { ...r, last: { key: r.key, value: r.value } } : r));
}

/** A row the user changed: emptied completely it is a removal, and forgets the entry it had. */
export function changedEntry<V>(row: EntryRow<V>, rules: EntryRules<V>): EntryRow<V> {
  return row.last && rules.blank(row) ? { ...row, last: undefined } : row;
}

/**
 * Rows for a map that came from outside (`fresh`, one per entry), with the rows that hold input
 * kept (never dropped): in the place of their last entry when the map still has it as it was, else
 * at the end as new rows (what they were renamed from may be back in the map).
 */
export function keepHeldRows<V>(fresh: EntryRow<V>[], rows: EntryRow<V>[], rules: EntryRules<V>): EntryRow<V>[] {
  const refused = entryRefusals(rows, rules);
  const next = [...fresh];
  const extra: EntryRow<V>[] = [];
  rows.forEach((row, i) => {
    if (!entryHeld(row, refused[i], rules)) return;
    const { last } = row;
    const at = last ? next.findIndex((f) => fresh.includes(f) && f.last?.key === last.key && sameValue(f.last.value, last.value)) : -1;
    if (at >= 0) next[at] = row;
    else extra.push({ ...row, last: undefined });
  });
  return [...next, ...extra];
}
