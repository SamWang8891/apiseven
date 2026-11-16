// The single-file export's Vite plugin (vite.single.config.ts): after the build, the entry script
// and the stylesheet go inside the HTML, which becomes dist-single/apiseven.html. A file opened from
// disk (file://) cannot load sibling files, so nothing may point at one: the head's favicon links
// become one inline PNG icon (no manifest, no apple-touch icon), and the build fails if any file is
// left over or any src/href in the page still names one.
import { readFileSync } from 'node:fs';
import type { Plugin, Rolldown } from 'vite';
import { LICENSE_FILES, THIRD_PARTY_FILE } from './licenseFiles.ts';

export const SINGLE_FILE_NAME = 'apiseven.html';

/** The head's icon and manifest links (and their comment) replaced by one `data:` PNG icon. */
export function inlineIcon(html: string, png: Buffer): string {
  const icon = `<link rel="icon" type="image/png" href="data:image/png;base64,${png.toString('base64')}" />`;
  const kept = html
    .split('\n')
    .filter((line) => !/<link rel="(icon|apple-touch-icon|manifest)"/.test(line) && !/<!-- Relative hrefs/.test(line));
  const title = kept.findIndex((line) => line.includes('</title>'));
  if (title === -1) throw new Error('index.html has no <title> to put the icon after');
  const indent = /^\s*/.exec(kept[title] ?? '')?.[0] ?? '';
  kept.splice(title + 1, 0, `${indent}${icon}`);
  return kept.join('\n');
}

/**
 * Module code made safe inside <script>…</script>: `</script` would end the element early. Written
 * `<\/script`, it means the same in a string, template or regular expression. `<!--` can change how
 * the HTML parser reads the rest of a script, and it has no safe rewrite: refused.
 */
export function scriptText(code: string): string {
  if (/<!--/.test(code)) throw new Error('the bundle contains "<!--", which cannot be inlined in a <script> safely');
  return code.replace(/<\/(script)/gi, '<\\/$1');
}

/** Style text made safe inside <style>…</style>. */
export function styleText(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/** The page's markup: the text inside script and style elements left out. */
export function markup(html: string): string {
  return html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>').replace(/<style\b([^>]*)>[\s\S]*?<\/style>/gi, '<style$1></style>');
}

/**
 * The comment the file starts with (C2): the NOTICE text, the licence, and where the bundled
 * libraries' licences are. No "--" may stand inside a comment (it would end it early, or be an error),
 * so each "-" followed by another is written "- "; nor may its text end with "-".
 */
export function noticeComment(notice: string): string {
  const text = [
    notice.trim(),
    '',
    'apiseven is licensed under the Apache License, Version 2.0 (Apache-2.0): LICENSE.txt.',
    `The licences of the libraries bundled in this file: ${THIRD_PARTY_FILE}, beside it (make single puts both in dist/).`,
  ].join('\n');
  return `<!--\n${text.replace(/-(?=-)/g, '- ').replace(/-$/, '- ')}\n-->`;
}

/** The src and href values in the page's markup that are not data: URLs or # links. */
export function fileReferences(html: string): string[] {
  return [...markup(html).matchAll(/\b(?:src|href)\s*=\s*["']?([^"'\s>]*)/gi)].map((m) => m[1] ?? '').filter((value) => !/^(data:|#)/i.test(value));
}

export function singleFile(iconPath: string, noticePath: string): Plugin {
  return {
    name: 'apiseven-single-file',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => inlineIcon(html, readFileSync(iconPath)),
    },
    // After Vite's own generateBundle hooks, which fill in placeholders such as __VITE_PRELOAD__.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        let html: string;
        try {
          html = `${noticeComment(readFileSync(noticePath, 'utf8'))}\n${inlineBundle(bundle)}`;
        } catch (err) {
          return this.error(err instanceof Error ? err.message : String(err));
        }
        this.emitFile({ type: 'asset', fileName: SINGLE_FILE_NAME, source: html });
      },
    },
  };
}

/** index.html with the entry script and the stylesheet inside it; takes them and index.html out of `bundle`. */
function inlineBundle(bundle: Rolldown.OutputBundle): string {
  const page = bundle['index.html'];
  if (page?.type !== 'asset') throw new Error('no index.html in the bundle');
  let html = String(page.source);
  for (const [name, file] of Object.entries(bundle)) {
    if (file.type === 'chunk' && file.isEntry) {
      const tag = new RegExp(`<script type="module"[^>]*\\ssrc="\\./${escapeRegExp(name)}"[^>]*></script>`);
      if (!tag.test(html)) throw new Error(`no <script> for ${name} in index.html`);
      html = html.replace(tag, () => `<script type="module">${scriptText(file.code)}</script>`);
      delete bundle[name];
    } else if (file.type === 'asset' && name.endsWith('.css')) {
      const tag = new RegExp(`<link rel="stylesheet"[^>]*\\shref="\\./${escapeRegExp(name)}"[^>]*>`);
      if (!tag.test(html)) throw new Error(`no <link> for ${name} in index.html`);
      html = html.replace(tag, () => `<style>${styleText(String(file.source))}</style>`);
      delete bundle[name];
    }
  }
  delete bundle['index.html'];
  // The licence files stay beside the page (licenseFiles.ts); nothing else may.
  const left = Object.keys(bundle).filter((name) => !(LICENSE_FILES as readonly string[]).includes(name));
  if (left.length > 0) throw new Error(`not inlined: ${left.join(', ')}`);
  const refs = fileReferences(html);
  if (refs.length > 0) throw new Error(`the page still names files: ${refs.join(', ')}`);
  return html;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
