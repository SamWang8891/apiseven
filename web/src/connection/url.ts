/**
 * Cleans an Admin API URL typed on the Connect page: trims it and drops trailing slashes and a
 * trailing /apisix/admin (the client adds that itself), so `http://h:9180/apisix/admin/` becomes
 * `http://h:9180`. Only http(s) URLs with a host are accepted.
 */
export function normalizeAdminUrl(input: string): { url: string } | { error: 'required' | 'invalid' } {
  const trimmed = input.trim();
  if (trimmed === '') return { error: 'required' };
  const url = trimmed.replace(/\/+$/, '').replace(/\/apisix\/admin$/, '').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'invalid' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.host === '') return { error: 'invalid' };
  return { url };
}

/** True when an https page would call an http URL, which browsers block as mixed content. */
export function isMixedContent(url: string, pageProtocol: string = window.location.protocol): boolean {
  return pageProtocol === 'https:' && /^http:/i.test(url);
}

/** The host:port of a connection's base URL, for labels; the URL itself if it doesn't parse. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
