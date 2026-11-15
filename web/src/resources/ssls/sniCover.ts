// Which of an SSL's SNIs its certificate does not name (Task 16 B21), judged as a client judges the
// certificate it is shown (RFC 6125 6.4.1, 6.4.3, as browsers apply it): a DNS name of the
// certificate (its subjectAltName dNSName entries; browsers no longer read the CN) names a host when
// it is the same name, ignoring case and a final dot, or when it is a wildcard written as the whole
// left-most label ("*.example.com") and the host has exactly one label in its place. Partial-label
// wildcards ("f*.example.com") and wildcards elsewhere name nothing. An SNI that is itself a wildcard
// stands for every one-label name under it, which only the same wildcard names; "*" stands for any
// name and is never named. An SNI that is an IP address (APISIX takes one, schema_def.lua 57) is named
// only by an IP address of the certificate (its iPAddress entries), compared by value: "2001:DB8::1"
// is "2001:db8:0:0:0:0:0:1" (fix round 1, R9). This is what a client accepts, which is not APISIX's
// SNI router (resolve.ts decides which certificate is presented; this decides whether the client
// takes it).
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

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** An IPv4 address's four numbers, or undefined. */
function v4(text: string): number[] | undefined {
  const parts = V4.exec(text)?.slice(1).map(Number);
  return parts && parts.every((n) => n <= 255) ? parts : undefined;
}

/** An IP address by value ("4:" or "6:" and its bytes in hex), or undefined when `text` is not one. */
export function ipValue(text: string): string | undefined {
  const bare = text.replace(/^\[(.*)\]$/, '$1');
  const four = v4(bare);
  if (four) return `4:${four.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  if (!bare.includes(':') || !/^[0-9a-fA-F:.]+$/.test(bare)) return undefined;
  const halves = bare.split('::');
  if (halves.length > 2) return undefined;
  const groups = (half: string): string[] | undefined => {
    if (half === '') return [];
    const out: string[] = [];
    const parts = half.split(':');
    for (const [i, part] of parts.entries()) {
      const tail = i === parts.length - 1 ? v4(part) : undefined;
      if (tail) out.push(((tail[0] ?? 0) * 256 + (tail[1] ?? 0)).toString(16), ((tail[2] ?? 0) * 256 + (tail[3] ?? 0)).toString(16));
      else if (/^[0-9a-fA-F]{1,4}$/.test(part)) out.push(part);
      else return undefined;
    }
    return out;
  };
  const head = groups(halves[0] ?? '');
  const rest = halves.length === 2 ? groups(halves[1] ?? '') : [];
  if (!head || !rest) return undefined;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  return `6:${[...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => g.toLowerCase().padStart(4, '0')).join('')}`;
}

/** Whether every name the SNI stands for is named by one of `dns` (an IP SNI: by one of `ips`). */
function covered(sni: string, dns: string[], ips: string[]): boolean {
  const ip = ipValue(sni);
  if (ip !== undefined) return ips.some((address) => ipValue(address) === ip);
  const s = canonical(sni);
  if (s === '*') return false;
  if (s.startsWith('*.')) return dns.some((name) => canonical(name) === s);
  return dns.some((name) => names(name, s));
}

/** The SNIs the certificate's names (`dns`, `ips`) don't cover, in their order, each once; a $secret:// / $env:// reference is not judged. */
export function uncoveredSnis(snis: string[], dns: string[], ips: string[]): string[] {
  return [...new Set(snis)].filter((sni) => !isSecretRef(sni) && !covered(sni, dns, ips));
}
