// @vitest-environment node
// The single-file export (vite.single.config.ts): its helpers, then a real build checked for what a
// file:// page needs: one file, nothing it names outside itself, the icon and the logo inside it.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LICENSE_FILES } from './licenseFiles';
import { fileReferences, inlineIcon, markup, noticeComment, scriptText, SINGLE_FILE_NAME } from './singleFile';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const base64 = (path: string) => readFileSync(here(path)).toString('base64');

describe('inlineIcon', () => {
  it("replaces index.html's icon and manifest links (and their comment) with one data: icon after the title", () => {
    const html = readFileSync(here('index.html'), 'utf8');
    const out = inlineIcon(html, Buffer.from('png!'));
    expect(out).not.toMatch(/rel="(manifest|apple-touch-icon)"/);
    expect(out).not.toContain('Relative hrefs');
    expect(out.match(/<link rel="icon"/g)).toEqual(['<link rel="icon"']);
    expect(out).toContain('<title>apiseven</title>\n    <link rel="icon" type="image/png" href="data:image/png;base64,cG5nIQ==" />');
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});

describe('scriptText', () => {
  it('writes </script as <\\/script, any case, so the element does not end early', () => {
    expect(scriptText('a="</script>";b=`</SCRIPT `;c=/<\\/script/')).toBe('a="<\\/script>";b=`<\\/SCRIPT `;c=/<\\/script/');
  });

  it('refuses <!--, which has no safe rewrite', () => {
    expect(() => scriptText('x="<!--"')).toThrow('<!--');
  });
});

describe('noticeComment', () => {
  it('is one HTML comment holding the notice, the licence and where the third-party list is, with no "--" inside to end it early', () => {
    const comment = noticeComment('A -- B --- C\nD-\n');
    expect(comment.startsWith('<!--\n')).toBe(true);
    expect(comment.endsWith('\n-->')).toBe(true);
    const inside = comment.slice('<!--'.length, -'-->'.length);
    expect(inside).not.toContain('--');
    expect(inside.endsWith('-')).toBe(false);
    expect(inside).toContain('A - - B - - - C');
    expect(inside).toContain('Apache-2.0');
    expect(inside).toContain('THIRD-PARTY-LICENSES.txt');
  });
});

describe('fileReferences', () => {
  it('finds src and href values in the markup that are not data: or # links, ignoring inline script and style text', () => {
    const html =
      '<link rel="icon" href="data:image/png;base64,AA"><a href="#/routes">x</a><img src=./logo.png>' +
      '<script type="module">const a = \'<img src="./in-script.png">\';</script><style>a{background:url(x.png)}</style><link href=\'./b.css\'>';
    expect(fileReferences(html)).toEqual(['./logo.png', './b.css']);
  });
});

describe('the built file', () => {
  let outDir = '';
  let html = '';

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'apiseven-single-'));
    // Vitest runs with NODE_ENV=test, which would make Vite bundle React's development build.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({ configFile: here('vite.single.config.ts'), root: here('.'), logLevel: 'silent', build: { outDir } });
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
    html = readFileSync(join(outDir, SINGLE_FILE_NAME), 'utf8');
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('is apiseven.html, beside the licence, the notice and the third-party licences (C2)', () => {
    expect(readdirSync(outDir).sort()).toEqual([...LICENSE_FILES, SINGLE_FILE_NAME].sort());
    expect(readFileSync(join(outDir, 'LICENSE.txt'), 'utf8')).toBe(readFileSync(here('../LICENSE'), 'utf8'));
    expect(readFileSync(join(outDir, 'NOTICE.txt'), 'utf8')).toBe(readFileSync(here('../NOTICE'), 'utf8'));
    // Vite's list of the bundled dependencies' licences (build.license): React's among them.
    expect(readFileSync(join(outDir, 'THIRD-PARTY-LICENSES.txt'), 'utf8')).toMatch(/^## react - \d/m);
  });

  it('starts with the notice, before the doctype: the NOTICE text, the licence, and where the third-party list is', () => {
    expect(html.startsWith(`${noticeComment(readFileSync(here('../NOTICE'), 'utf8'))}\n<!doctype html>`)).toBe(true);
  });

  // Checked on the markup (script and style text left out), which is short enough to print on failure.
  it('names no other file: one inline script and style, no stylesheet, preload or manifest link, no src or href but data: and #', () => {
    const page = markup(html);
    expect(fileReferences(html)).toEqual([]);
    expect(page.match(/<script\b[^>]*>/g)).toEqual(['<script type="module">']);
    expect(page.match(/<style\b[^>]*>/g)).toEqual(['<style>']);
    expect(page).not.toMatch(/rel="(stylesheet|modulepreload|manifest|apple-touch-icon)"/);
  });

  it('carries the tab icon inline, built from favicon-32x32.png', () => {
    const page = markup(html);
    expect(page).toContain(`<link rel="icon" type="image/png" href="data:image/png;base64,${base64('public/favicon-32x32.png')}" />`);
    expect(page.match(/rel="icon"/g)).toHaveLength(1);
  });

  it('carries the logo inline', () => {
    // toBe(true): a failure would otherwise print the whole 1.8 MB file.
    expect(html.includes(`data:image/png;base64,${base64('src/assets/logo.png')}`)).toBe(true);
  });

  it('holds the lazy parts too (CodeMirror loads lazily in the normal build), and imports no file', () => {
    expect(html.includes('cm-editor')).toBe(true);
    expect(/import\(\s*["'`]\.{1,2}\//.test(html)).toBe(false);
    // Vite fills these placeholders in after the plugins' own generateBundle; inlined earlier, they stay and throw.
    expect(html.match(/__VITE_[A-Z_]+__/g) ?? []).toEqual([]);
  });
});

describe('vite.single.config.ts', () => {
  it('is derived from vite.config.ts: its plugins and anything added there (a define here) reach the single file too', async () => {
    const shared = (await import('./vite.config.ts')).default as Record<string, unknown>;
    shared.define = { __APISEVEN_PROBE__: '"1"' };
    try {
      const single = (await import('./vite.single.config.ts')).default as Record<string, unknown>;
      const names = (plugins: unknown) => (plugins as unknown[]).flat(4).map((p) => (p as { name?: string }).name);
      expect(names(single.plugins)).toEqual([...names(shared.plugins), 'apiseven-single-file']);
      expect(single.define).toEqual({ __APISEVEN_PROBE__: '"1"' });
      expect(single.base).toBe(shared.base);
      expect(single.test).toBeUndefined();
      expect(single.build).toMatchObject({ outDir: 'dist-single', rolldownOptions: { output: { codeSplitting: false } } });
    } finally {
      delete shared.define;
    }
  });
});
