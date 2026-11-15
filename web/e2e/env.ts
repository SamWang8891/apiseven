// Where the end-to-end suite finds APISIX, the gateway and the apiseven image. Every value can be
// overridden by an environment variable; the defaults are the dev stack (dev/compose.yaml) and the
// image `make docker` builds. playwright.config.ts lists them too.

function read(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function hostPort(value: string, name: string): { host: string; port: number } {
  const match = /^(.+):(\d+)$/.exec(value);
  if (!match) throw new Error(`${name} must be host:port, got ${JSON.stringify(value)}`);
  return { host: match[1]!, port: Number(match[2]) };
}

const adminUrl = read('E2E_ADMIN_URL', 'http://127.0.0.1:19180').replace(/\/+$/, '').replace(/\/apisix\/admin$/, '');
const previewPort = Number(read('E2E_PREVIEW_PORT', '4173'));

export const env = {
  /** The Admin API as this machine (and the browser) reaches it, without /apisix/admin. */
  adminUrl,
  adminKey: read('E2E_ADMIN_KEY', 'apiseven-dev-admin-key'),
  viewerKey: read('E2E_VIEWER_KEY', 'apiseven-dev-viewer-key'),
  /** The gateway's plain HTTP listener. */
  gatewayUrl: read('E2E_GATEWAY_URL', 'http://127.0.0.1:9080').replace(/\/+$/, ''),
  /** The gateway's HTTPS listener (SSL objects' certificates). */
  gatewayHttps: hostPort(read('E2E_GATEWAY_HTTPS', '127.0.0.1:9443'), 'E2E_GATEWAY_HTTPS'),
  /** The gateway's TCP stream proxy (the seed's stream route etcd-tcp listens there). */
  gatewayStream: hostPort(read('E2E_GATEWAY_STREAM', '127.0.0.1:9100'), 'E2E_GATEWAY_STREAM'),
  previewPort,
  baseURL: `http://127.0.0.1:${previewPort}`,
  /** The Docker network of the APISIX container; the proxy-mode container joins it. */
  dockerNetwork: read('E2E_DOCKER_NETWORK', 'apiseven-dev_default'),
  /** The Admin API as a container on that network reaches it. */
  dockerAdminUrl: read('E2E_DOCKER_ADMIN_URL', 'http://apisix:9180'),
  /** The apiseven image the proxy-mode spec runs (`make docker`). */
  image: read('E2E_IMAGE', 'apiseven:local'),
};

/**
 * Inside the APISIX container: the upstream the suite proxies to. The dev stack's etcd answers
 * GET /version and GET /health with JSON, so a route to it shows a real upstream's response without
 * the public internet or another container (dev/compose.yaml names the service `etcd`).
 */
export const ECHO = { host: 'etcd', port: 2379, path: '/version', body: /"etcdserver"/ };
