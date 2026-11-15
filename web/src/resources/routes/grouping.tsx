import { LockKeyhole } from 'lucide-react';
import { t } from '../../i18n';
import { ExpiryBadge } from '../expiry';
import type { Grouping } from '../registry';
import { routeHosts, sslExpiries, sslForHost } from '../resolve';

/**
 * Routes by host, as APISIX matches them: one group per host string (a wildcard host is a group of
 * its own, not expanded), service hosts included, a route with several hosts in each. The header
 * shows the host, its route count and the expiry of the certificate APISIX serves for it.
 */
export const hostGrouping: Grouping = {
  id: 'host',
  get label() {
    return t('group.byHost');
  },
  get ungroupedLabel() {
    return t('group.anyHost');
  },
  groupBy: (item, ctx) => routeHosts(item.value, ctx).hosts,
  header: (host, items, ctx) => {
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
