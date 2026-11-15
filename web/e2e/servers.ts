// Small HTTP servers some specs start for themselves: the build under a sub-path, and a page on a
// second origin. Each listens on a free loopback port and is closed by the spec.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as netServer } from 'node:net';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<Running> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** Serves the files under `root` at `prefix` (`/sub/`); anything else is 404. */
export function serveStatic(root: string, prefix: string): Promise<Running> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (!path.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const rel = normalize(path.slice(prefix.length) || 'index.html').replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
    readFile(file).then(
      (body) => res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end(),
    );
  });
  return listen(server);
}

/** Serves one HTML page at `/`. */
export function servePage(html: string): Promise<Running> {
  return listen(createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)));
}

/** A loopback port nothing listens on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = netServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}
