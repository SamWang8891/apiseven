// Quick-filter chips of the upstreams list. Options come from the upstreams themselves.
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import type { Option } from '../../ui';
import { balancerLabel } from '../../upstream/meta';
import { referencesTo } from '../resolve';
import { healthLabel, healthOf, schemeOf, typeOf, type HealthState } from './columns';

const collator = new Intl.Collator(undefined, { numeric: true });
const byLabel = (a: Option, b: Option): number => collator.compare(a.label, b.label);
const HEALTH: HealthState[] = ['active', 'both', 'off'];

export const upstreamFilters: FilterDef[] = [
  {
    id: 'type',
    get label() {
      return t('filter.type');
    },
    options: (items) => [...new Set(items.map((item) => typeOf(item.value)))].map((type) => ({ value: type, label: balancerLabel(type) })).sort(byLabel),
    matches: (item, selected) => selected.includes(typeOf(item.value)),
  },
  {
    id: 'scheme',
    get label() {
      return t('filter.scheme');
    },
    options: (items) => [...new Set(items.map((item) => schemeOf(item.value)))].map((scheme) => ({ value: scheme, label: scheme })).sort(byLabel),
    matches: (item, selected) => selected.includes(schemeOf(item.value)),
  },
  {
    id: 'health',
    get label() {
      return t('filter.health');
    },
    options: () => HEALTH.map((state) => ({ value: state, label: healthLabel(state) })),
    matches: (item, selected) => selected.includes(healthOf(item.value)),
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
    matches: (item, selected, ctx) => selected.includes(referencesTo('upstreams', item.id, ctx).length === 0 ? 'unused' : 'used'),
  },
];
