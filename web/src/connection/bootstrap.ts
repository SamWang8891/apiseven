import { isObj } from '../api/sanitize';

/**
 * What apiseven's own server (Docker mode) says at ./config.json: where it proxies the Admin API,
 * and whether the user must paste a key (false when the server injects APISIX_ADMIN_KEY itself).
 */
export type ServerConfig = { adminBase: string; keyRequired: boolean };

/**
 * Reads ./config.json, next to the page. Undefined means static mode: a 404, a failed request,
 * a body that isn't JSON (a dev server's SPA fallback answers index.html), or the wrong shape.
 */
export async function loadServerConfig(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<ServerConfig | undefined> {
  try {
    const res = await fetchImpl(new URL('config.json', document.baseURI).href, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const body = JSON.parse(await res.text()) as unknown;
    if (isObj(body) && typeof body.adminBase === 'string' && typeof body.keyRequired === 'boolean') {
      return { adminBase: body.adminBase, keyRequired: body.keyRequired };
    }
  } catch {
    // Static mode.
  }
  return undefined;
}

/** The connection base URL for a server config: adminBase resolved against the page, minus /apisix/admin. */
export function serverBaseUrl(config: ServerConfig): string {
  return new URL(config.adminBase, document.baseURI).href.replace(/\/+$/, '').replace(/\/apisix\/admin$/, '');
}
