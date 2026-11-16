// The suite's own access to the source of truth: the Admin API (what is stored) and the gateway
// (what APISIX does with it). Plain Node, no browser; used by the fixtures and the global setup.
import { request as httpRequest } from 'node:http';
import { connect as tlsConnect, type PeerCertificate } from 'node:tls';
import { adminPathOfKey } from '../../dev/adminPath.mjs';
import { env } from './env';

export type Json = Record<string, unknown>;

/** Every kind the Admin API lists, in an order that deletes referrers before what they reference. */
export const KINDS = [
  'global_rules',
  'stream_routes',
  'routes',
  'services',
  'plugin_configs',
  'consumers',
  'consumer_groups',
  'upstreams',
  'ssls',
  'protos',
  'secrets',
  'plugin_metadata',
] as const;
export type ListKind = (typeof KINDS)[number];

/** JSON with every object's keys sorted, so two equal values give the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A stored value without its timestamps (what a write changes by itself). */
export function withoutTimes(value: Json | undefined): Json | undefined {
  if (!value) return value;
  const rest = { ...value };
  delete rest.create_time;
  delete rest.update_time;
  return rest;
}

export interface AdminReply {
  status: number;
  body: Json;
}

/** A thin Admin API client. Paths are below /apisix/admin, already encoded (`routes/e2e-r1`). */
export class Admin {
  readonly base: string;
  readonly key: string;

  constructor(base = env.adminUrl, key = env.adminKey) {
    this.base = base;
    this.key = key;
  }

  async request(method: string, path: string, body?: unknown): Promise<AdminReply> {
    const res = await fetch(`${this.base}/apisix/admin/${path}`, {
      method,
      headers: { 'X-API-KEY': this.key, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Json;
    try {
      parsed = text ? (JSON.parse(text) as Json) : {};
    } catch {
      parsed = { text };
    }
    return { status: res.status, body: parsed };
  }

  private async ok(method: string, path: string, body?: unknown): Promise<Json> {
    const reply = await this.request(method, path, body);
    if (reply.status >= 300) {
      throw new Error(`${method} ${path}: HTTP ${reply.status} ${JSON.stringify(reply.body).slice(0, 300)}`);
    }
    return reply.body;
  }

  /** The stored item (`{ key, value, modifiedIndex, … }`), or undefined when APISIX answers 404. */
  async item(path: string): Promise<Json | undefined> {
    const reply = await this.request('GET', path);
    if (reply.status === 404) return undefined;
    if (reply.status >= 300) throw new Error(`GET ${path}: HTTP ${reply.status} ${JSON.stringify(reply.body)}`);
    return reply.body;
  }

  /** The stored value as APISIX returns it, or undefined when absent. */
  async raw(path: string): Promise<Json | undefined> {
    return (await this.item(path))?.value as Json | undefined;
  }

  /** The stored value without its timestamps: what an exact comparison should look at. */
  async value(path: string): Promise<Json | undefined> {
    return withoutTimes(await this.raw(path));
  }

  /** The stored value; fails when the object is absent. */
  async must(path: string): Promise<Json> {
    const value = await this.value(path);
    if (!value) throw new Error(`${path} is not stored`);
    return value;
  }

  put(path: string, body: unknown): Promise<Json> {
    return this.ok('PUT', path, body);
  }

  post(path: string, body: unknown): Promise<Json> {
    return this.ok('POST', path, body);
  }

  patch(path: string, body: unknown): Promise<Json> {
    return this.ok('PATCH', path, body);
  }

  /** Deletes; an absent object is fine. */
  async del(path: string): Promise<void> {
    const reply = await this.request('DELETE', `${path}${path.includes('?') ? '&' : '?'}force=true`);
    if (reply.status >= 300 && reply.status !== 404) {
      throw new Error(`DELETE ${path}: HTTP ${reply.status} ${JSON.stringify(reply.body)}`);
    }
  }

  /** Every stored item of a kind: `{ key, value }` pairs as APISIX lists them. */
  async list(kind: string): Promise<{ key: string; value: Json }[]> {
    const reply = await this.request('GET', kind);
    if (reply.status === 404) return [];
    if (reply.status >= 300) throw new Error(`GET ${kind}: HTTP ${reply.status}`);
    return (reply.body.list as { key: string; value: Json }[] | undefined) ?? [];
  }

  /** How many objects of each kind are stored, credentials per consumer included. */
  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const kind of KINDS) {
      const items = await this.list(kind);
      out[kind] = items.length;
      if (kind === 'consumers') {
        for (const { value } of items) {
          const username = String(value.username);
          out[`credentials of ${username}`] = (await this.list(`consumers/${encodeURIComponent(username)}/credentials`)).length;
        }
      }
    }
    return out;
  }

  /**
   * Every stored object by its etcd key, credentials included, as JSON without `update_time` (a write
   * changes it by itself): what the teardown compares with the seed.
   */
  async snapshot(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const add = (key: string, value: Json) => {
      const copy = { ...value };
      delete copy.update_time;
      out[key] = stable(copy);
    };
    for (const kind of KINDS) {
      for (const { key, value } of await this.list(kind)) {
        add(key, value);
        if (kind === 'consumers') {
          for (const cred of await this.list(`consumers/${encodeURIComponent(String(value.username))}/credentials`)) add(cred.key, cred.value);
        }
      }
    }
    return out;
  }

  /**
   * Deletes every object whose id (or name, username, SNI) starts with `prefix`, referrers first:
   * a spec's afterAll, so a failed test leaves nothing behind.
   */
  async removePrefixed(prefix: string): Promise<void> {
    // Consumer usernames are written with underscores where ids have hyphens.
    const prefixes = [prefix, prefix.replace(/-/g, '_')];
    const matches = (name: string) => prefixes.some((p) => name.startsWith(p));
    for (const kind of KINDS) {
      for (const { key, value } of await this.list(kind)) {
        const snis = Array.isArray(value.snis) ? (value.snis as unknown[]) : [];
        const names = [value.id, value.name, value.username, value.sni, ...snis].map((v) => (typeof v === 'string' ? v : ''));
        // From the key, whatever the instance's etcd prefix (deployment.etcd.prefix).
        const { path, rest: tail } = adminPathOfKey(key, kind);
        if (names.some(matches) || tail.split('/').some(matches)) {
          await this.del(path);
        } else if (kind === 'consumers') {
          // A kept consumer may hold this spec's credentials.
          for (const cred of await this.list(`${path}/credentials`)) {
            const id = cred.key.split('/').pop() ?? '';
            const name = typeof cred.value.name === 'string' ? cred.value.name : '';
            if (matches(id) || matches(name)) await this.del(`${path}/credentials/${encodeURIComponent(id)}`);
          }
        }
      }
    }
  }
}

export interface GatewayReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

/** One request to the gateway; `host` sets the Host header (routes match on it). */
export function gateway(
  path: string,
  opts: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<GatewayReply> {
  const url = new URL(path, env.gatewayUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: opts.method ?? 'GET', headers: { ...(opts.host && { Host: opts.host }), ...opts.headers }, timeout: 15_000 },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`gateway ${path}: timed out`)));
    req.on('error', reject);
    req.end(opts.body);
  });
}

/**
 * Calls `probe` until `accept` holds or the deadline passes, then returns the last result. APISIX
 * sees an Admin API change through its etcd watch, usually within a second; this waits on that
 * without a fixed sleep.
 */
export async function eventually<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (!accept(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    last = await probe();
  }
  return last;
}

/** The certificate the HTTPS listener presents for `servername`. */
export function servedCertificate(servername: string): Promise<PeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: env.gatewayHttps.host, port: env.gatewayHttps.port, servername, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert);
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error(`TLS to ${servername}: timed out`)));
    socket.on('error', reject);
  });
}
