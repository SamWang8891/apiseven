import type { Item } from '../api/types';
import { withoutPrivateKeys } from '../schema/secrets';
import type { Ctx } from '../resources/ctx';
import type { Option } from '../ui';

/** A quick filter shown as a chip: a multi-select over values found in the data. */
export interface FilterDef {
  id: string;
  label: string;
  /** The choices, computed from the items (e.g. every plugin in use). */
  options(items: Item[], ctx: Ctx): Option[];
  /** Whether the item passes with these values selected; only called when `selected` is not empty. */
  matches(item: Item, selected: string[], ctx: Ctx): boolean;
}

/** Selected values per filter id. */
export type FilterSelection = Record<string, string[]>;

/** What of an item the search reads: its value as stored, or as a kind shows it (secrets masked: ResourceDef.masksSearch). */
export type SearchValue = (item: Item) => unknown;

const stored: SearchValue = (item) => item.value;

// The search text of an item, built once per stored object (lists keep item identity between fetches)
// and per way of reading it. A private key's text is never in it, wherever it is stored (an SSL whose
// cert also holds its key): a search must not tell whether a key starts with what was typed.
const haystacks = new WeakMap<SearchValue, WeakMap<Item, string>>();

function haystack(item: Item, read: SearchValue): string {
  let texts = haystacks.get(read);
  if (!texts) {
    texts = new WeakMap();
    haystacks.set(read, texts);
  }
  let text = texts.get(item);
  if (text === undefined) {
    text = withoutPrivateKeys(`${item.id} ${JSON.stringify(read(item))}`, ' ').toLowerCase();
    texts.set(item, text);
  }
  return text;
}

/** Splits a search into lower-case terms. */
export function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every space-separated term of `query` appears, ignoring case, somewhere in the item:
 * its id or any key or value of the stored object (as JSON text). An empty query matches all.
 */
export function matchesQuery(item: Item, query: string, read: SearchValue = stored): boolean {
  const words = terms(query);
  if (words.length === 0) return true;
  const text = haystack(item, read);
  return words.every((word) => text.includes(word));
}

/** The items that match the query (read through `read`) and, for each filter with something selected, one of its values. */
export function applyFilters(items: Item[], query: string, filters: FilterDef[], selection: FilterSelection, ctx: Ctx, read: SearchValue = stored): Item[] {
  const active = filters.filter((f) => (selection[f.id]?.length ?? 0) > 0);
  if (terms(query).length === 0 && active.length === 0) return items;
  return items.filter(
    (item) => matchesQuery(item, query, read) && active.every((f) => f.matches(item, selection[f.id] ?? [], ctx)),
  );
}

// Filter selections live in the URL as f.<id>=a,b; a comma or percent sign inside a value is escaped.
const PREFIX = 'f.';
const escape = (v: string): string => v.replace(/%/g, '%25').replace(/,/g, '%2C');
const unescape = (v: string): string => v.replace(/%2C/gi, ',').replace(/%25/g, '%');

/** Reads every `f.<id>=a,b` search param. */
export function readSelection(params: URLSearchParams): FilterSelection {
  const selection: FilterSelection = {};
  for (const [key, value] of params) {
    if (!key.startsWith(PREFIX) || value === '') continue;
    selection[key.slice(PREFIX.length)] = value.split(',').map(unescape);
  }
  return selection;
}

/** A copy of `params` with its `f.*` params replaced by `selection` (empty selections left out). */
export function writeSelection(params: URLSearchParams, selection: FilterSelection): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of params) if (!key.startsWith(PREFIX)) next.append(key, value);
  for (const [id, values] of Object.entries(selection)) {
    if (values.length > 0) next.set(PREFIX + id, values.map(escape).join(','));
  }
  return next;
}
