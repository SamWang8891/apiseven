import { LockKeyhole } from 'lucide-react';
import { t } from '../../i18n';
import { ExpiryBadge } from '../expiry';
import type { Grouping } from '../registry';
import { routeHosts, sslForHost } from '../resolve';

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
    return (
      <>
        <span className="cell-group__host mono">{host}</span>
        <span className="tbl-group__count">{items.length}</span>
        <span className="cell-group__cert" title={match ? undefined : t('group.noCert', { host })}>
          <LockKeyhole size={13} aria-hidden="true" />
          <span className="ui-sr-only">{t('group.cert')}</span>
          <ExpiryBadge notAfter={match?.notAfter} />
        </span>
      </>
    );
  },
};
