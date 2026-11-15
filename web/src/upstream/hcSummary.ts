// One-line summaries of the health checks' sections (Probe, Mark healthy / unhealthy after, and the
// passive counts), shown while a section is closed: every value the upstream sets that the open
// section shows for the check's protocol (HealthChecks.tsx: the active probe's HTTP fields hide for
// tcp, the certificate check shows for https only; the passive ones always show), in the order of
// the fields, or "defaults". Pure.
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

/** Whether a check block reads HTTP's fields: any protocol but tcp (http is the default). */
const http = (block: Obj): boolean => (str(block.type) ?? 'http') !== 'tcp';

/** The active probe: protocol, method, path, host, port, timeout, concurrency, TLS check, body, headers. */
export function probeSummary(active: Obj): string {
  const web = http(active);
  const headers = Array.isArray(active.req_headers) ? active.req_headers.length : 0;
  return join([
    str(active.type),
    web && str(active.http_method),
    web && str(active.http_path),
    str(active.host) && t('up.hc.sum.host', { host: str(active.host) ?? '' }),
    count('up.hc.sum.port', active.port),
    count('up.hc.sum.timeout', active.timeout),
    count('up.hc.sum.concurrency', active.concurrency),
    str(active.type) === 'https' && active.https_verify_certificate === false && t('up.hc.sum.noVerify'),
    web && str(active.http_req_body) && t('up.hc.sum.body'),
    web && headers > 0 && t('up.hc.sum.headers', { n: headers }),
  ]);
}

/** Active "Mark healthy after": interval, successes, statuses (HTTP). */
export function healthySummary(active: Obj): string {
  const healthy = obj(active.healthy);
  return join([count('up.hc.sum.every', healthy.interval), count('up.hc.sum.successes', healthy.successes), http(active) && statuses(healthy.http_statuses)]);
}

/** Active "Mark unhealthy after": interval, HTTP failures, TCP failures, timeouts, statuses (HTTP's for HTTP only). */
export function unhealthySummary(active: Obj): string {
  const unhealthy = obj(active.unhealthy);
  const web = http(active);
  return join([
    count('up.hc.sum.every', unhealthy.interval),
    web && count('up.hc.sum.httpFailures', unhealthy.http_failures),
    count('up.hc.sum.tcpFailures', unhealthy.tcp_failures),
    count('up.hc.sum.timeouts', unhealthy.timeouts),
    web && statuses(unhealthy.http_statuses),
  ]);
}

/** Passive "Count as healthy": successes, statuses (whatever the type: they count on HTTP routes, HealthChecks.tsx). */
export function passiveHealthySummary(passive: Obj): string {
  const healthy = obj(passive.healthy);
  return join([count('up.hc.sum.successes', healthy.successes), statuses(healthy.http_statuses)]);
}

/** Passive "Count as unhealthy": HTTP failures, TCP failures, timeouts, statuses (whatever the type, as the section shows them). */
export function passiveUnhealthySummary(passive: Obj): string {
  const unhealthy = obj(passive.unhealthy);
  return join([
    count('up.hc.sum.httpFailures', unhealthy.http_failures),
    count('up.hc.sum.tcpFailures', unhealthy.tcp_failures),
    count('up.hc.sum.timeouts', unhealthy.timeouts),
    statuses(unhealthy.http_statuses),
  ]);
}
