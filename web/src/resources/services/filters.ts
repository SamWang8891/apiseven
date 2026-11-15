// Quick-filter chips of the services list. Options come from the services themselves (what is in use).
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import { labelPairs, referencesTo } from '../resolve';
import { servicePlugins } from './columns';

const collator = new Intl.Collator(undefined, { numeric: true });

export const serviceFilters: FilterDef[] = [
  {
    id: 'plugin',
    get label() {
      return t('filter.plugin');
    },
    options: (items) => {
      const names = new Set(items.flatMap((item) => servicePlugins(item.value).map((p) => p.name)));
      return [...names].sort(collator.compare).map((name) => ({ value: name, label: name }));
    },
    matches: (item, selected) => servicePlugins(item.value).some((p) => selected.includes(p.name)),
  },
  {
    id: 'unused',
    get label() {
      return t('filter.unused');
    },
    options: () => [
      { value: 'unused', label: t('filter.unused.yes') },
      { value: 'used', label: t('filter.unused.no') },
    ],
    // Routes and stream routes both count (referencesTo, as APISIX's delete_checker does).
    matches: (item, selected, ctx) => selected.includes(referencesTo('services', item.id, ctx).length === 0 ? 'unused' : 'used'),
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
