// Quick-filter chips of the plugin configs list: by plugin, and whether a route names it.
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import { servicePlugins } from '../services/columns';
import { routesOf } from './columns';

const collator = new Intl.Collator(undefined, { numeric: true });

export const pluginConfigFilters: FilterDef[] = [
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
    // Until the routes have loaded, a plugin config is neither (routesOf).
    matches: (item, selected, ctx) => {
      const users = routesOf(item, ctx);
      return users !== undefined && selected.includes(users.length === 0 ? 'unused' : 'used');
    },
  },
];
