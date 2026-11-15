// Quick-filter chips of the consumers list. Options come from the consumers themselves (what is in use).
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import { labelPairs } from '../resolve';
import { servicePlugins as ownPlugins } from '../services/columns';
import { groupName } from './columns';

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * The "No group" option's value. Not '' (an empty value is lost in the URL: table/filter.ts
 * readSelection), and no group id can be it: id_schema allows no spaces or parentheses.
 */
export const NO_GROUP = '(no group)';

/** The consumer's group id as the filter keys it (NO_GROUP for none). */
const groupOf = (value: Record<string, unknown>): string => {
  const g = value.group_id;
  return typeof g === 'number' ? String(g) : typeof g === 'string' && g !== '' ? g : NO_GROUP;
};

export const consumerFilters: FilterDef[] = [
  {
    id: 'group',
    get label() {
      return t('filter.group');
    },
    options: (items, ctx) => {
      const ids = new Map<string, string>();
      for (const item of items) ids.set(groupOf(item.value), groupOf(item.value) === NO_GROUP ? t('filter.noGroup') : (groupName(item, ctx) ?? ''));
      // "No group" first, then the groups by name.
      return [...ids].sort(([a, x], [b, y]) => (a === NO_GROUP ? -1 : b === NO_GROUP ? 1 : collator.compare(x, y))).map(([value, label]) => ({ value, label }));
    },
    matches: (item, selected) => selected.includes(groupOf(item.value)),
  },
  {
    id: 'plugin',
    get label() {
      return t('filter.plugin');
    },
    options: (items) => {
      const names = new Set(items.flatMap((item) => ownPlugins(item.value).map((p) => p.name)));
      return [...names].sort(collator.compare).map((name) => ({ value: name, label: name }));
    },
    matches: (item, selected) => ownPlugins(item.value).some((p) => selected.includes(p.name)),
  },
  {
    id: 'label',
    get label() {
      return t('filter.label');
    },
    options: (items) => {
      const pairs = new Set(items.flatMap((item) => labelPairs(item.value.labels).map(([key, value]) => `${key}:${value}`)));
      return [...pairs].sort(collator.compare).map((pair) => ({ value: pair, label: pair }));
    },
    matches: (item, selected) => labelPairs(item.value.labels).some(([key, value]) => selected.includes(`${key}:${value}`)),
  },
];

