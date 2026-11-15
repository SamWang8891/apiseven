// Quick-filter chips of the routes list. Options come from the routes themselves (what is in use).
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import type { Option } from '../../ui';
import { effectivePlugins, isEnabled, labelPairs, nameOfValue, resolveRef, routeHosts, routeHostsLoading, routeHostsUnknown } from '../resolve';
import { methodsOf } from './methods';

export { ANY_METHOD } from './methods';

/** The `service` filter's value for routes without a service (APISIX ids never hold spaces or brackets). */
export const NO_SERVICE = '(no service)';
/** The `host` filter's value for routes that match any host (a host never holds a space or parentheses: host_def_pat, schema_def.lua 56). */
export const ANY_HOST = '(any host)';
/** The `host` filter's value for routes whose hosts come from a service when the services could not be read (Task 16b, item 162). */
export const UNKNOWN_HOST = '(hosts unknown)';

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
    // The hosts it matches, its service's when it sets none (routeHosts, as the Hosts column). While the
    // services have not loaded, a route that takes its hosts from one has hosts unknown: it is neither
    // offered nor matched as Any host (addendum rule 12), and matches no host until they are known.
    // When the services could not be read, such a route has an option of its own (item 162).
    id: 'host',
    get label() {
      return t('filter.host');
    },
    options: (items, ctx) => {
      const hosts = new Set<string>();
      let anyHost = false;
      let unknown = false;
      for (const item of items) {
        if (routeHostsLoading(item.value, ctx)) continue;
        if (routeHostsUnknown(item.value, ctx)) {
          unknown = true;
          continue;
        }
        const own = routeHosts(item.value, ctx).hosts;
        if (own.length === 0) anyHost = true;
        for (const host of own) hosts.add(host);
      }
      const options = [...hosts].sort(collator.compare).map((host) => ({ value: host, label: host }));
      return [...options, ...(anyHost ? [{ value: ANY_HOST, label: t('filter.anyHost') }] : []), ...(unknown ? [{ value: UNKNOWN_HOST, label: t('filter.hostUnknown') }] : [])];
    },
    matches: (item, selected, ctx) => {
      if (routeHostsLoading(item.value, ctx)) return false;
      if (routeHostsUnknown(item.value, ctx)) return selected.includes(UNKNOWN_HOST);
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
