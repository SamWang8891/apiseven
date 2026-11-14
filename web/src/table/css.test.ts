/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the table's and the list page's CSS source (Vitest blanks CSS imports, so read from disk).
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  { name: 'table/table.css', prefix: 'tbl-' },
  { name: 'table/toolbar.css', prefix: 'tbl-' },
  { name: 'pages/list.css', prefix: 'list-' },
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

  it('keeps body text and its secondary colour on the row cells', () => {
    const cells = rules(files[0]?.css ?? '').find(([sel]) => sel === '.tbl-row > td');
    expect(cells?.[1]).toMatch(/(^|;|\s)color:\s*var\(--text\)\s*(;|$)/);
  });
});
