// Quick-filter chips of the upstreams list. Options come from the upstreams themselves.
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import type { Option } from '../../ui';
import { balancerLabel } from '../../upstream/meta';
import { referenceLists } from '../resolve';
import { healthLabel, healthOf, schemeOf, typeOf, usedBy, type HealthState } from './columns';

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
    // After a list that can point at an upstream failed to load, the usage is unknown: an option of its own.
    options: (_items, ctx) => [
      { value: 'unused', label: t('filter.unused.yes') },
      { value: 'used', label: t('filter.unused.no') },
      ...(referenceLists('upstreams').some((list) => ctx.failed[list] && !ctx.loaded[list]) ? [{ value: 'unknown', label: t('filter.unused.unknown') }] : []),
    ],
    // While the lists load, an upstream is none of them (usedBy).
    matches: (item, selected, ctx) => {
      const refs = usedBy(item, ctx);
      if (refs === 'loading') return false;
      return selected.includes(refs === 'unknown' ? 'unknown' : refs.length === 0 ? 'unused' : 'used');
    },
  },
];
