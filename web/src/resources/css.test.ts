/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the resource pieces' CSS sources (Vitest blanks CSS imports, so read from disk): the list
// cells (cell-), the shared editor pieces, Section and ResourcePicker (res-), and the route editor's
// tabs (rt-).
const dir = dirname(fileURLToPath(import.meta.url));
const FILES = [
  { name: 'cells.css', prefix: 'cell-' },
  { name: 'resources.css', prefix: 'res-' },
  { name: 'routes/routes.css', prefix: 'rt-' },
];

function rules(name: string): [string, string][] {
  const css = readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

describe.each(FILES)('$name', ({ name, prefix }) => {
  it(`uses only the ${prefix} prefix, plus the shared mono helper`, () => {
    expect(rules(name).length).toBeGreaterThan(5);
    for (const [sel] of rules(name)) {
      if (sel.startsWith('@')) continue;
      for (const cls of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        const c = cls[1] ?? '';
        expect(c.startsWith(prefix) || c === 'mono', `.${c} in ${sel}`).toBe(true);
      }
    }
  });

  it('takes colours from the tokens only', () => {
    for (const [sel, decl] of rules(name)) {
      expect(decl, sel).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i);
    }
  });

  it('never fades anything: no opacity, no filters', () => {
    for (const [sel, decl] of rules(name)) expect(decl, sel).not.toMatch(/opacity\s*:|filter\s*:/);
  });
});
