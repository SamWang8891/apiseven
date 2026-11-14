import type { Item } from '../api/types';

/** A row of the table body: a group header, or an item (an item in several groups has a row in each). */
export type TableRow =
  | { type: 'group'; key: string; /** null for the ungrouped items. */ group: string | null; items: Item[] }
  | { type: 'item'; key: string; item: Item };

export interface PageModel {
  rows: TableRow[];
  /** 0-based, clamped to the pages there are. */
  page: number;
  pageCount: number;
  /** 1-based number of the first and last item row on this page (0 and 0 when empty). */
  start: number;
  end: number;
  /** Item rows over all pages: with groups, an item counts once per group it is in. */
  total: number;
}

const collator = new Intl.Collator(undefined, { numeric: true });

interface Entry {
  group: string | null;
  item: Item;
}

/** Items in group order (by name, the ungrouped last), each group keeping the sorted order. */
function grouped(sorted: Item[], groupBy: (item: Item) => string[]): { entries: Entry[]; members: Map<string | null, Item[]> } {
  const members = new Map<string | null, Item[]>();
  const ungrouped: Item[] = [];
  for (const item of sorted) {
    const groups = [...new Set(groupBy(item).filter((g) => g !== ''))];
    if (groups.length === 0) ungrouped.push(item);
    for (const group of groups) {
      const list = members.get(group);
      if (list) list.push(item);
      else members.set(group, [item]);
    }
  }
  const names = [...members.keys()].filter((g): g is string => g !== null).sort(collator.compare);
  const entries: Entry[] = names.flatMap((group) => (members.get(group) ?? []).map((item) => ({ group, item })));
  if (ungrouped.length > 0) {
    members.set(null, ungrouped);
    entries.push(...ungrouped.map((item) => ({ group: null, item })));
  }
  return { entries, members };
}

/**
 * One page of rows. Paging counts item rows only; with `groupBy`, each group on the page gets its
 * header row, so a page that starts in the middle of a group repeats that group's header.
 */
export function buildPage(sorted: Item[], page: number, pageSize: number, groupBy?: (item: Item) => string[]): PageModel {
  const { entries, members }: { entries: Entry[]; members?: Map<string | null, Item[]> } = groupBy
    ? grouped(sorted, groupBy)
    : { entries: sorted.map((item) => ({ group: null, item })) };
  const total = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const from = current * pageSize;
  const slice = entries.slice(from, from + pageSize);

  const rows: TableRow[] = [];
  let previous: string | null | undefined;
  for (const { group, item } of slice) {
    const groupKey = group ?? '\u0000';
    if (members && group !== previous) {
      rows.push({ type: 'group', key: `group:${groupKey}`, group, items: members.get(group) ?? [] });
      previous = group;
    }
    rows.push({ type: 'item', key: members ? `${groupKey}\u0001${item.id}` : item.id, item });
  }
  return { rows, page: current, pageCount, start: slice.length ? from + 1 : 0, end: from + slice.length, total };
}
