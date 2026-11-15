import type { Kind } from '../api/types';

/**
 * The sidebar's groups, in order (labels are i18n keys). Credentials have no entry: they live under
 * their consumer. The command palette lists its groups in the same order.
 */
export const NAV_GROUPS: { label: string; kinds: Kind[] }[] = [
  { label: 'nav.traffic', kinds: ['routes', 'stream_routes', 'services', 'upstreams'] },
  { label: 'nav.access', kinds: ['consumers', 'consumer_groups', 'ssls', 'secrets'] },
  { label: 'nav.plugins', kinds: ['global_rules', 'plugin_configs', 'plugin_metadata'] },
  { label: 'nav.other', kinds: ['protos'] },
];

/** Every kind with a list page, in sidebar order. */
export const NAV_KINDS: Kind[] = NAV_GROUPS.flatMap((group) => group.kinds);
