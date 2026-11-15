// One-line summaries of the health checks' sections (Probe, Mark healthy / unhealthy after, and the
// passive counts), shown while a section is closed: every value the upstream sets, in the order of
// the fields, or "defaults" when it sets none. Pure.
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { num, obj, str } from './values';

const SEP = ' · ';

function join(parts: (string | undefined | false)[]): string {
  const set = parts.filter((p): p is string => typeof p === 'string' && p !== '');
  return set.length > 0 ? set.join(SEP) : t('up.hc.sum.defaults');
}

/** The statuses stored, as written ("200, 302"); undefined when none are. */
function statuses(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return t('up.hc.sum.statuses', { list: v.map(String).join(', ') });
}

const count = (key: string, v: unknown): string | undefined => {
  const n = num(v);
  return n === undefined ? undefined : t(key, { n });
};

/** The active probe: protocol, method, path, host, port, timeout, concurrency, TLS check, body, headers. */
export function probeSummary(active: Obj): string {
  const headers = Array.isArray(active.req_headers) ? active.req_headers.length : 0;
  return join([
    str(active.type),
    str(active.http_method),
    str(active.http_path),
    str(active.host) && t('up.hc.sum.host', { host: str(active.host) ?? '' }),
    count('up.hc.sum.port', active.port),
    count('up.hc.sum.timeout', active.timeout),
    count('up.hc.sum.concurrency', active.concurrency),
    active.https_verify_certificate === false && t('up.hc.sum.noVerify'),
    str(active.http_req_body) && t('up.hc.sum.body'),
    headers > 0 && t('up.hc.sum.headers', { n: headers }),
  ]);
}

/** Active "Mark healthy after": interval, successes, statuses. */
export function healthySummary(active: Obj): string {
  const healthy = obj(active.healthy);
  return join([count('up.hc.sum.every', healthy.interval), count('up.hc.sum.successes', healthy.successes), statuses(healthy.http_statuses)]);
}

/** Active "Mark unhealthy after": interval, HTTP failures, TCP failures, timeouts, statuses. */
export function unhealthySummary(active: Obj): string {
  const unhealthy = obj(active.unhealthy);
  return join([
    count('up.hc.sum.every', unhealthy.interval),
    count('up.hc.sum.httpFailures', unhealthy.http_failures),
    count('up.hc.sum.tcpFailures', unhealthy.tcp_failures),
    count('up.hc.sum.timeouts', unhealthy.timeouts),
    statuses(unhealthy.http_statuses),
  ]);
}

/** Passive "Count as healthy": successes, statuses. */
export function passiveHealthySummary(passive: Obj): string {
  const healthy = obj(passive.healthy);
  return join([count('up.hc.sum.successes', healthy.successes), statuses(healthy.http_statuses)]);
}

/** Passive "Count as unhealthy": HTTP failures, TCP failures, timeouts, statuses. */
export function passiveUnhealthySummary(passive: Obj): string {
  const unhealthy = obj(passive.unhealthy);
  return join([
    count('up.hc.sum.httpFailures', unhealthy.http_failures),
    count('up.hc.sum.tcpFailures', unhealthy.tcp_failures),
    count('up.hc.sum.timeouts', unhealthy.timeouts),
    statuses(unhealthy.http_statuses),
  ]);
}
