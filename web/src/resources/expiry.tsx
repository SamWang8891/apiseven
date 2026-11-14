import type { FC } from 'react';
import { t } from '../i18n';
import { Empty } from '../table/cells';
import { formatAbsolute } from '../table/format';
import { Badge } from '../ui';
import './cells.css';

/** How close a certificate is to expiring: `none` when its expiry is unknown. */
export type ExpiryTone = 'ok' | 'warn' | 'danger' | 'none';

const DAY_MS = 86_400_000;
/** With fewer days than this left, an expiry warns. */
const WARN_DAYS = 14;

/** `danger` once `notAfterMs` is reached, `warn` with less than 14 days left, else `ok`. */
// eslint-disable-next-line react-refresh/only-export-components -- the pinned API keeps the tone beside the badge that shows it
export function expiryTone(notAfterMs: number | undefined, nowMs = Date.now()): ExpiryTone {
  if (notAfterMs === undefined) return 'none';
  if (notAfterMs <= nowMs) return 'danger';
  return notAfterMs - nowMs < WARN_DAYS * DAY_MS ? 'warn' : 'ok';
}

/** Whole days from `nowMs` until `notAfterMs`. */
function daysLeft(notAfterMs: number, nowMs = Date.now()): number {
  return Math.floor((notAfterMs - nowMs) / DAY_MS);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local date, YYYY-MM-DD. */
function dateOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A certificate's expiry: `69d 2027-01-22` (amber under 14 days), `expired 2026-11-11` in red, or
 * a plain — when it is unknown. The exact time is in the title.
 */
export const ExpiryBadge: FC<{ notAfter: number | undefined; now?: number }> = ({ notAfter, now }) => {
  const tone = expiryTone(notAfter, now);
  if (notAfter === undefined || tone === 'none') return <Empty />;
  const date = dateOf(notAfter);
  return (
    <Badge tone={tone} className={`expiry--${tone}`} title={t('expiry.title', { date: formatAbsolute(notAfter / 1000) })}>
      {tone === 'danger' ? (
        t('expiry.expired', { date })
      ) : (
        <>
          {t('expiry.days', { days: daysLeft(notAfter, now) })} <span className="cell-expiry__date">{date}</span>
        </>
      )}
    </Badge>
  );
};
