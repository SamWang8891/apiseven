// Rows of key → value that edit a map (KeyValueInput; the schema form's map rows). The rule, in three lines:
//   1. The map is a pure function of the rows (entriesOf), recomputed and sent on every change to the rows
//      (typing, leaving a row, add, remove) whenever it differs from what was last sent.
//   2. "Used twice" is judged on the keys the rows show now; a held row's kept entry never reserves a key.
//   3. A good row is in the map as shown; a held row keeps its last committed entry there, in its place,
//      unless a good row shows that key: so whenever nothing is held, the map is exactly the rows as shown.
// "Held": a row that shows something it can't put in the map (no key, a key used twice, a key or value
// the rules refuse), or that was kept through a change of the value from outside (below). "Committed":
// a row commits its entry when it is left while good (blur; Save leaves the field first), so keys typed
// on the way to a taken one ("e", "en" before "env") are never what a held row keeps. A row emptied
// completely (no key, no value) is a removal, as is its Remove button.
// A value from outside replaces the rows but keeps the rows that hold input, marked `carried`: held until
// the user edits them, because what made them held may be gone with the old value (a rival key), and
// they must not turn good and differ from the value nobody sent. So rule 3 holds then too.

/** JSON values compared as data (a value from outside is a new object with the same content). */
const sameValue = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

export interface EntryRow<V> {
  id: number;
  key: string;
  value: V;
  /** The entry this row last committed to the map: the stored one, then each good one it is left with. */
  last?: { key: string; value: V };
  /** Carried over a change of the value from outside while it held input: held until the user edits it. */
  carried?: boolean;
}

export interface EntryRules<V> {
  /** Why a key another row shows is refused (a message, or a marker the caller turns into one). */
  duplicate: (key: string) => string;
  /** Why a changed key is refused besides that, if it is (a key pattern). A row's own unchanged key never is. */
  refuseKey?: (key: string) => string | undefined;
  /** Why the row's value keeps it out of the map, if it does (no value). */
  refuseValue?: (row: EntryRow<V>) => string | undefined;
  /** A row with nothing in it (no key, no value): it holds nothing, and emptied, it removes its entry. */
  blank: (row: EntryRow<V>) => boolean;
  /** Why a row carried over an outside change is held (a message, or a marker the caller turns into one). */
  carried: (row: EntryRow<V>) => string;
}

/** The row shows the key it committed (a stored entry nobody renamed, or a rename already left). */
const unchanged = <V>(row: EntryRow<V>): boolean => row.last !== undefined && row.key === row.last.key;

/**
 * Why each row's current entry stays out of the map ('' for no key, else the rules' message), or
 * undefined when it goes in. A changed key that is empty or refused by the key rules is out; of the
 * other rows that show one key, one keeps it and the rest are "used twice": the one showing its own
 * committed key, else one whose value is good, else the first. A row's own unchanged key is never
 * refused by the key rules (stored data stays until someone changes it).
 */
export function entryRefusals<V>(rows: EntryRow<V>[], rules: EntryRules<V>): (string | undefined)[] {
  const keyRefusal = rows.map((row) => (row.carried ? rules.carried(row) : unchanged(row) ? undefined : row.key === '' ? '' : rules.refuseKey?.(row.key)));
  const valueRefusal = rows.map((row) => rules.refuseValue?.(row));
  const rank = (i: number): number => (unchanged(rows[i] as EntryRow<V>) ? 2 : 0) + (valueRefusal[i] === undefined ? 1 : 0);
  const keeper = new Map<string, number>();
  rows.forEach((row, i) => {
    if (keyRefusal[i] !== undefined) return;
    const other = keeper.get(row.key);
    if (other === undefined || rank(i) > rank(other)) keeper.set(row.key, i);
  });
  return rows.map((row, i) => keyRefusal[i] ?? (keeper.get(row.key) === i ? valueRefusal[i] : rules.duplicate(row.key)));
}

/** Whether a row holds input it can't put in the map (refused, and not blank). */
export const entryHeld = <V>(row: EntryRow<V>, refusal: string | undefined, rules: EntryRules<V>): boolean => refusal !== undefined && !rules.blank(row);

/**
 * The map the rows make, in row order: each good row's entry as shown; for a held row, its last
 * committed entry unless a good row shows that key (or an earlier held row already keeps it).
 */
export function entriesOf<V>(rows: EntryRow<V>[], rules: EntryRules<V>): Record<string, V> {
  const refused = entryRefusals(rows, rules);
  const shown = new Set(rows.filter((_, i) => refused[i] === undefined).map((row) => row.key));
  const kept = new Set<string>();
  const map: Record<string, V> = {};
  rows.forEach((row, i) => {
    const refusal = refused[i];
    if (refusal === undefined) map[row.key] = row.value;
    else if (entryHeld(row, refusal, rules) && row.last && !shown.has(row.last.key) && !kept.has(row.last.key)) {
      kept.add(row.last.key);
      map[row.last.key] = row.last.value;
    }
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

/** A row the user changed: it is theirs again (no longer carried); emptied completely it is a removal, and forgets its entry. */
export function changedEntry<V>(row: EntryRow<V>, rules: EntryRules<V>): EntryRow<V> {
  const own = row.carried ? { ...row, carried: undefined } : row;
  return own.last && rules.blank(own) ? { ...own, last: undefined } : own;
}

/**
 * Rows for a map that came from outside (`fresh`, one per entry), with the rows that hold input
 * carried over (never dropped) and marked `carried`, so they stay held until the user edits them: in
 * the place of their last entry when the map still has it as it was (that entry is then what they
 * keep), else at the end keeping nothing (what they were renamed from may be gone, or back in the
 * map). The rows then make exactly `map` (`entriesOf(result) = map`), so nothing needs sending: a
 * carried row can't turn good without an edit, and an edit goes through the editor's update, which sends.
 */
export function keepHeldRows<V>(fresh: EntryRow<V>[], rows: EntryRow<V>[], rules: EntryRules<V>): EntryRow<V>[] {
  const refused = entryRefusals(rows, rules);
  const next = [...fresh];
  const extra: EntryRow<V>[] = [];
  rows.forEach((row, i) => {
    if (!entryHeld(row, refused[i], rules)) return;
    const { last } = row;
    const at = last ? next.findIndex((f) => fresh.includes(f) && f.last?.key === last.key && sameValue(f.last.value, last.value)) : -1;
    if (at >= 0) next[at] = { ...row, carried: true };
    else extra.push({ ...row, last: undefined, carried: true });
  });
  return [...next, ...extra];
}
