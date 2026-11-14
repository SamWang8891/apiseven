import { t } from '../i18n';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago an APISIX timestamp (`create_time` / `update_time`, epoch seconds) was:
 * just now, 5m ago, 3h ago, 2d ago, 4mo ago (30-day months), 2y ago (365-day years).
 */
export function formatRelative(epochSeconds: number | undefined, nowMs = Date.now()): string {
  if (epochSeconds === undefined || !Number.isFinite(epochSeconds)) return t('ui.empty');
  const seconds = Math.floor(nowMs / 1000 - epochSeconds);
  if (seconds < MINUTE) return t('time.justNow');
  if (seconds < HOUR) return t('time.minutes', { n: Math.floor(seconds / MINUTE) });
  if (seconds < DAY) return t('time.hours', { n: Math.floor(seconds / HOUR) });
  const days = Math.floor(seconds / DAY);
  if (days < 30) return t('time.days', { n: days });
  if (days < 365) return t('time.months', { n: Math.floor(days / 30) });
  return t('time.years', { n: Math.floor(days / 365) });
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local date and time of an epoch-seconds timestamp: 2026-11-14 09:30:05. */
export function formatAbsolute(epochSeconds: number | undefined): string {
  if (epochSeconds === undefined || !Number.isFinite(epochSeconds)) return t('ui.empty');
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
