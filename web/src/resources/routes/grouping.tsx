import { LockKeyhole } from 'lucide-react';
import { t } from '../../i18n';
import { ExpiryBadge } from '../expiry';
import type { Grouping } from '../registry';
import { routeHosts, routeHostsLoading, routeHostsUnknown, sslExpiries, sslForHost } from '../resolve';

/** The group of routes whose hosts come from a service while the services load (a host never holds parentheses). */
export const HOSTS_LOADING = '(hosts loading)';
/** The group of routes whose hosts come from a service when the services could not be read. */
export const HOSTS_UNKNOWN = '(hosts unknown)';

/**
 * Routes by host, as APISIX matches them: one group per host string (a wildcard host is a group of
 * its own, not expanded), service hosts included, a route with several hosts in each. The header
 * shows the host, its route count and the expiry of the certificate APISIX serves for it. A route
 * whose hosts come from a service waits for the services, as the Hosts cell and filter do: grouped
 * as loading, then as unknown if they failed, never as "any host" (Task 16b, item 162).
 */
export const hostGrouping: Grouping = {
  id: 'host',
  get label() {
    return t('group.byHost');
  },
  get ungroupedLabel() {
    return t('group.anyHost');
  },
  groupBy: (item, ctx) => (routeHostsLoading(item.value, ctx) ? [HOSTS_LOADING] : routeHostsUnknown(item.value, ctx) ? [HOSTS_UNKNOWN] : routeHosts(item.value, ctx).hosts),
  header: (host, items, ctx) => {
    if (host === HOSTS_LOADING || host === HOSTS_UNKNOWN) {
      return (
        <>
          <span className="cell-muted">{t(host === HOSTS_LOADING ? 'group.hostsLoading' : 'group.hostsUnknown')}</span>
          <span className="tbl-group__count">{items.length}</span>
        </>
      );
    }
    const match = sslForHost(host, ctx);
    // Certificates sharing the SNI: APISIX serves the one it loaded first, so show the soonest expiry.
    const expiries = sslExpiries(match).filter((n): n is number => n !== undefined);
    const shared = match && match.shared.length > 0 ? t('group.sharedCert', { host, count: match.shared.length + 1 }) : undefined;
    return (
      <>
        <span className="cell-group__host mono">{host}</span>
        <span className="tbl-group__count">{items.length}</span>
        <span className="cell-group__cert" title={!ctx.loaded.ssls ? t('picker.loading') : match ? shared : t('group.noCert', { host })}>
          <LockKeyhole size={13} aria-hidden="true" />
          <span className="ui-sr-only">{t('group.cert')}</span>
          <ExpiryBadge notAfter={expiries.length > 0 ? Math.min(...expiries) : undefined} />
        </span>
      </>
    );
  },
};
