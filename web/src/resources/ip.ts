// IP address text as APISIX reads it, shared by the route, stream route and upstream checks: IPv4 as
// the schema's `ipv4` format takes it (no leading zeros), IPv6 as inet_pton(AF_INET6) does (the
// `ipv6` format, and core.utils.parse_ipv6). Pure.

const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
/** A dotted IPv4 address. */
export const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
/** An IPv4 address with a CIDR prefix of 0–32 without leading zeros (ip_def in schema_def.lua). */
export const IPV4_CIDR = new RegExp(`^${OCTET}(\\.${OCTET}){3}/([12]?[0-9]|3[0-2])$`);
const GROUP = /^[0-9a-fA-F]{1,4}$/;

/** What inet_pton(AF_INET6) takes, as APISIX's jsonschema checks the `ipv6` format. */
export function isIPv6(text: string): boolean {
  let s = text;
  // A trailing IPv4 (::ffff:10.0.0.1) stands for the last two groups.
  if (s.includes('.')) {
    const at = s.lastIndexOf(':');
    if (at < 0 || !IPV4.test(s.slice(at + 1))) return false;
    s = `${s.slice(0, at + 1)}0:0`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string | undefined) => (part === undefined || part === '' ? [] : part.split(':'));
  const all = [...groups(halves[0]), ...groups(halves[1])];
  if (!all.every((g) => GROUP.test(g))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}
