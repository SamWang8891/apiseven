// Quick-filter chips of the SSL list. Each says only what is true of APISIX: a client certificate's
// status does nothing (usage.ts statusApplies), and "no route host" is not "unused" for a server
// certificate that TLS clients still get for its SNIs, so the usage chip names what it checked.
import { t } from '../../i18n';
import type { FilterDef } from '../../table/filter';
import { expiryTone } from '../expiry';
import { isEnabled, sslNotAfter } from '../resolve';
import { statusApplies, typeOf, usageCount } from './usage';

const EXPIRY = ['expired', 'soon', 'ok', 'unknown'] as const;
const BUCKET = { danger: 'expired', warn: 'soon', ok: 'ok', none: 'unknown' } as const;

export const sslFilters: FilterDef[] = [
  {
    id: 'status',
    get label() {
      return t('table.status');
    },
    options: () => [
      { value: 'enabled', label: t('table.status.enabled') },
      { value: 'disabled', label: t('table.status.disabled') },
    ],
    // A client certificate is in neither: APISIX uses it whatever its status.
    matches: (item, selected) => statusApplies(item.value) && selected.includes(isEnabled(item.value) ? 'enabled' : 'disabled'),
  },
  {
    id: 'type',
    get label() {
      return t('filter.type');
    },
    options: () => [
      { value: 'server', label: t('ssl.type.server') },
      { value: 'client', label: t('ssl.type.client') },
    ],
    matches: (item, selected) => selected.includes(typeOf(item.value)),
  },
  {
    id: 'expiry',
    get label() {
      return t('filter.expiry');
    },
    options: () => EXPIRY.map((bucket) => ({ value: bucket, label: t(`filter.expiry.${bucket}`) })),
    matches: (item, selected) => selected.includes(BUCKET[expiryTone(sslNotAfter(item.value))]),
  },
  {
    id: 'unused',
    get label() {
      return t('filter.unused');
    },
    options: () => [
      { value: 'unused', label: t('ssl.filter.none') },
      { value: 'used', label: t('ssl.filter.some') },
    ],
    // Nothing while a list it depends on loads: neither answer would be known.
    matches: (item, selected, ctx) => {
      const count = usageCount(item, ctx);
      return count !== undefined && selected.includes(count === 0 ? 'unused' : 'used');
    },
  },
];
