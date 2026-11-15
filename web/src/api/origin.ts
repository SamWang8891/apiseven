/**
 * Whether an Admin API base URL is on the page's own origin: relative, or absolute with the page's
 * origin. Only apiseven's own server (Docker mode, config.json) is reached that way; any other base
 * URL is APISIX itself. The API client decides two things by it: the X-Apiseven-Request header that
 * the server's proxy requires (APISIX would have to allow it in CORS), and sending the browser's
 * credentials (the server's Basic auth; APISIX answers `Access-Control-Allow-Origin: *`, which
 * browsers honour only without credentials). A page without an origin (file://) has no server, and
 * neither has no page at all (Node).
 */
export function isPageOrigin(baseUrl: string, pageUrl?: string): boolean {
  const pageAt = pageUrl ?? (typeof document === 'undefined' ? undefined : document.baseURI);
  if (pageAt === undefined) return false;
  try {
    const page = new URL(pageAt);
    return page.origin !== 'null' && new URL(baseUrl, page).origin === page.origin;
  } catch {
    return false;
  }
}
