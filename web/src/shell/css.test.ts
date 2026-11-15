/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the shell's and the Connect page's CSS source (Vitest blanks CSS imports, so read from disk).
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  { name: 'shell/shell.css', prefix: 'shell-' },
  { name: 'connection/connect.css', prefix: 'connect-' },
  { name: 'shell/palette.css', prefix: 'cp-' },
].map(({ name, prefix }) => ({
  name,
  prefix,
  css: readFileSync(join(src, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

function rules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

describe('shell, palette and connect CSS', () => {
  it('uses only its own class prefix (or the bare root class), plus the shared mono helper', () => {
    for (const { name, prefix, css } of files) {
      for (const [sel] of rules(css)) {
        for (const cls of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          const c = cls[1] ?? '';
          expect(c.startsWith(prefix) || c === prefix.slice(0, -1) || c === 'mono', `${name}: .${c}`).toBe(true);
        }
      }
    }
  });

  it('takes colours from the tokens only', () => {
    for (const { name, css } of files) {
      for (const [sel, body] of rules(css)) {
        expect(body, `${name}: ${sel}`).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i);
      }
    }
  });

  // Task 16b item 161: in a narrow header the crumbs give way inside their box, never over the tools.
  it('breadcrumbs stay in their box: the list clips, kinds give way last, an id keeps room for its ellipsis', () => {
    const shell = files.find((f) => f.name === 'shell/shell.css')?.css ?? '';
    const body = (selector: string) => rules(shell).find(([sel]) => sel === selector)?.[1] ?? '';
    expect(body('.shell-crumbs')).toMatch(/overflow:\s*hidden/);
    const shrink = (selector: string) => Number(/flex-shrink:\s*([\d.]+)/.exec(body(selector))?.[1]);
    const [kind, id, lastId] = [shrink('.shell-crumbs__item:not(.shell-crumbs__item--id)'), shrink('.shell-crumbs__item--id'), shrink('.shell-crumbs__item--id:last-child')];
    // At least 1: a line whose flexible items' factors add up to less gives way only in part (CSS flexbox 9.7).
    expect(kind).toBeGreaterThanOrEqual(1);
    expect(kind).toBeLessThan(lastId);
    expect(lastId).toBeLessThan(id);
    expect(body('.shell-crumbs__item--id')).toMatch(/min-width:\s*\d+(\.\d+)?ch/);
  });

  it('never fades anything with opacity or filters', () => {
    for (const { name, css } of files) {
      for (const [sel, body] of rules(css)) {
        expect(body, `${name}: ${sel}`).not.toMatch(/opacity\s*:\s*(?!1\s*(?:;|$))|filter\s*:/);
      }
    }
  });
});
