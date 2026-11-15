/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the CSS source of the table, the list page and the list cells (Vitest blanks CSS imports, so read from disk).
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  { name: 'table/table.css', prefix: 'tbl-' },
  { name: 'table/toolbar.css', prefix: 'tbl-' },
  { name: 'pages/list.css', prefix: 'list-' },
  { name: 'resources/cells.css', prefix: 'cell-' },
].map(({ name, prefix }) => ({
  name,
  prefix,
  css: readFileSync(join(src, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

function rules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

describe('table and list page CSS', () => {
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

  // Fix round 1, R6.2 and R6.3: what keyboard focus brings into view is never under the sticky header
  // or the chip row's faded end.
  it('scroll padding clears the sticky header (both densities) and the chip row\'s faded ends', () => {
    const all = files.flatMap(({ css }) => rules(css));
    const body = (selector: string) => all.filter(([sel]) => sel === selector).map(([, b]) => b).join(';');
    expect(body('.tbl-scroll')).toMatch(/scroll-padding-top:\s*36px/);
    expect(body('.tbl--compact .tbl-scroll')).toMatch(/scroll-padding-top:\s*32px/);
    expect(body('.tbl-toolbar__filters')).toMatch(/scroll-padding-inline:\s*32px/);
  });

  it('takes colours from the tokens only', () => {
    for (const { name, css } of files) {
      for (const [sel, body] of rules(css)) {
        expect(body, `${name}: ${sel}`).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i);
      }
    }
  });

  it('never fades anything with opacity or filters (a disabled row stays full contrast)', () => {
    for (const { name, css } of files) {
      for (const [sel, body] of rules(css)) {
        expect(body, `${name}: ${sel}`).not.toMatch(/opacity\s*:|filter\s*:/);
      }
    }
  });

  it('ellipsises chip text that is wider than its column, inside a chip capped at the column width', () => {
    const cells = rules(files.find((f) => f.name === 'resources/cells.css')?.css ?? '');
    const body = (sel: string) => cells.find(([s]) => s === sel)?.[1] ?? '';
    expect(body('.cell-chip')).toMatch(/max-width:\s*100%/);
    expect(body('.cell-chip')).toMatch(/min-width:\s*0/);
    expect(body('.cell-chip__text')).toMatch(/overflow:\s*hidden/);
    expect(body('.cell-chip__text')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('keeps body text and its secondary colour on the row cells', () => {
    const cells = rules(files[0]?.css ?? '').find(([sel]) => sel === '.tbl-row > td');
    expect(cells?.[1]).toMatch(/(^|;|\s)color:\s*var\(--text\)\s*(;|$)/);
  });
});
