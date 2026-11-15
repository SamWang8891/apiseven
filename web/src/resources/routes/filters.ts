// Quick-filter chips of the routes list. Options come from the routes themselves (what is in use).
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import type { Option } from '../../ui';
import { effectivePlugins, isEnabled, labelPairs, nameOfValue, resolveRef, routeHosts } from '../resolve';

/** The `service` filter's value for routes without a service (APISIX ids never hold spaces or brackets). */
export const NO_SERVICE = '(no service)';
/** The `host` filter's value for routes that match any host (a host never holds spaces or brackets). */
export const ANY_HOST = '(any host)';
/** The `method` filter's value for routes that match any method (as the list's column says it). */
export const ANY_METHOD = 'ANY';

/** The methods a route matches, as the list's column shows them: ANY when it sets none. */
function methodsOf(value: Record<string, unknown>): string[] {
  const methods = Array.isArray(value.methods) ? value.methods.filter((m): m is string => typeof m === 'string' && m !== '') : [];
  return methods.length > 0 ? methods : [ANY_METHOD];
}

const collator = new Intl.Collator(undefined, { numeric: true });
const byLabel = (a: Option, b: Option): number => collator.compare(a.label, b.label);

export const routeFilters: FilterDef[] = [
  {
    id: 'status',
    get label() {
      return t('table.status');
    },
    options: () => [
      { value: 'enabled', label: t('table.status.enabled') },
      { value: 'disabled', label: t('table.status.disabled') },
    ],
    matches: (item, selected) => selected.includes(isEnabled(item.value) ? 'enabled' : 'disabled'),
  },
  {
    // The hosts it matches, its service's when it sets none (routeHosts, as the Hosts column).
    id: 'host',
    get label() {
      return t('filter.host');
    },
    options: (items, ctx) => {
      const hosts = new Set<string>();
      let anyHost = false;
      for (const item of items) {
        const own = routeHosts(item.value, ctx).hosts;
        if (own.length === 0) anyHost = true;
        for (const host of own) hosts.add(host);
      }
      const options = [...hosts].sort(collator.compare).map((host) => ({ value: host, label: host }));
      return anyHost ? [...options, { value: ANY_HOST, label: t('filter.anyHost') }] : options;
    },
    matches: (item, selected, ctx) => {
      const hosts = routeHosts(item.value, ctx).hosts;
      return hosts.length === 0 ? selected.includes(ANY_HOST) : hosts.some((host) => selected.includes(host));
    },
  },
  {
    id: 'method',
    get label() {
      return t('filter.method');
    },
    options: (items) => {
      const methods = new Set(items.flatMap((item) => methodsOf(item.value)));
      return [...methods].sort(collator.compare).map((method) => ({ value: method, label: method }));
    },
    matches: (item, selected) => methodsOf(item.value).some((method) => selected.includes(method)),
  },
  {
    id: 'plugin',
    get label() {
      return t('filter.plugin');
    },
    options: (items, ctx) => {
      const names = new Set(items.flatMap((item) => effectivePlugins(item.value, ctx).map((p) => p.name)));
      return [...names].sort(collator.compare).map((name) => ({ value: name, label: name }));
    },
    matches: (item, selected, ctx) => effectivePlugins(item.value, ctx).some((p) => selected.includes(p.name)),
  },
  {
    id: 'service',
    get label() {
      return t('filter.service');
    },
    options: (items, ctx) => {
      const used = new Map<string, string>();
      let unbound = false;
      for (const item of items) {
        const target = resolveRef('services', item.value.service_id, ctx);
        if (!target) unbound = true;
        else used.set(target.id, target.item ? (nameOfValue(target.item.value) ?? target.id) : target.id);
      }
      const options = [...used].map(([value, label]) => ({ value, label })).sort(byLabel);
      return unbound ? [...options, { value: NO_SERVICE, label: t('filter.noService') }] : options;
    },
    matches: (item, selected, ctx) => selected.includes(resolveRef('services', item.value.service_id, ctx)?.id ?? NO_SERVICE),
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
