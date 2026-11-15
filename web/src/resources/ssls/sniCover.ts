// Which of an SSL's SNIs its certificate does not name (Task 16 B21), judged as a client judges the
// certificate it is shown (RFC 6125 6.4.1, 6.4.3, as browsers apply it): a DNS name of the
// certificate (its subjectAltName dNSName entries; browsers no longer read the CN) names a host when
// it is the same name, ignoring case and a final dot, or when it is a wildcard written as the whole
// left-most label ("*.example.com") and the host has exactly one label in its place. Partial-label
// wildcards ("f*.example.com") and wildcards elsewhere name nothing. An SNI that is itself a wildcard
// stands for every one-label name under it, which only the same wildcard names; "*" stands for any
// name and is never named. This is what a client accepts, which is not APISIX's SNI router
// (resolve.ts decides which certificate is presented; this decides whether the client takes it).
import { isSecretRef } from './validate';

const canonical = (name: string): string => name.toLowerCase().replace(/\.$/, '');

/** Whether the certificate name `name` names the host `host`. */
function names(name: string, host: string): boolean {
  const n = canonical(name);
  const h = canonical(host);
  if (!n.includes('*')) return n === h;
  if (!n.startsWith('*.') || n.indexOf('*', 1) !== -1) return false;
  const dot = h.indexOf('.');
  return n.length > 2 && dot > 0 && !h.slice(0, dot).includes('*') && h.slice(dot + 1) === n.slice(2);
}

/** Whether every name the SNI stands for is named by one of `dns`. */
function covered(sni: string, dns: string[]): boolean {
  const s = canonical(sni);
  if (s === '*') return false;
  if (s.startsWith('*.')) return dns.some((name) => canonical(name) === s);
  return dns.some((name) => names(name, s));
}

/** The SNIs no name in `dns` covers, in their order, each once; a $secret:// / $env:// reference is not judged. */
export function uncoveredSnis(snis: string[], dns: string[]): string[] {
  return [...new Set(snis)].filter((sni) => !isSecretRef(sni) && !covered(sni, dns));
}
