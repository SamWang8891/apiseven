// Quick-filter chips of the secrets list: by manager.
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import { managerName } from './columns';
import { isManager } from './schemas';

export const secretFilters: FilterDef[] = [
  {
    id: 'manager',
    get label() {
      return t('filter.manager');
    },
    options: (items) =>
      [...new Set(items.map(managerName))]
        .filter((m) => m !== '')
        .sort()
        .map((m) => ({ value: m, label: isManager(m) ? t(`sc.manager.${m}`) : m })),
    matches: (item, selected) => selected.includes(managerName(item)),
  },
];
