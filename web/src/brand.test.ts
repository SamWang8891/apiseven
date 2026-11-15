/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The browser icon and the web app manifest. The build must work from any path (Vite `base: './'`),
// so every URL here is relative: a leading `/` would break the icons under a sub-path.
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(web, 'public');

/** Not absolute (`/x`), protocol-relative (`//host/x`) or with a scheme (`https:`, `data:`). */
const isRelative = (url: string) => !url.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(url);

describe('index.html', () => {
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  const head = new DOMParser().parseFromString(html, 'text/html').head;
  const links = [...head.querySelectorAll('link')].map((l) => ({
    rel: l.getAttribute('rel'),
    type: l.getAttribute('type'),
    sizes: l.getAttribute('sizes'),
    href: l.getAttribute('href'),
  }));

  it('links the favicon set and the manifest with relative URLs', () => {
    expect(links).toEqual(
      expect.arrayContaining([
        { rel: 'icon', type: null, sizes: 'any', href: './favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: './favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: './favicon-16x16.png' },
        { rel: 'apple-touch-icon', type: null, sizes: '180x180', href: './apple-touch-icon.png' },
        { rel: 'manifest', type: null, sizes: null, href: './site.webmanifest' },
      ]),
    );
  });

  // Behind apiseven's Basic auth: browsers fetch a manifest without credentials unless asked to.
  it('fetches the manifest with credentials', () => {
    expect(head.querySelector('link[rel="manifest"]')?.getAttribute('crossorigin')).toBe('use-credentials');
  });

  it('has no href that starts with /, and each one names a file in public/', () => {
    const hrefs = [...html.matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1] ?? '');
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) {
      expect(href.startsWith('/'), href).toBe(false);
      expect(isRelative(href), href).toBe(true);
      expect(existsSync(join(pub, href)), href).toBe(true);
    }
  });
});

describe('site.webmanifest', () => {
  it('names the app and points at icons that exist, by relative URLs', () => {
    const manifest = JSON.parse(readFileSync(join(pub, 'site.webmanifest'), 'utf8')) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      icons?: { src: string; sizes: string; type: string }[];
    };
    expect(manifest.name).toBe('apiseven');
    expect(manifest.short_name).toBe('apiseven');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons?.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons ?? []) {
      expect(isRelative(icon.src), icon.src).toBe(true);
      expect(existsSync(join(pub, icon.src)), icon.src).toBe(true);
    }
  });
});
