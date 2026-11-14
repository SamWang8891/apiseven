/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the Plugins tab's CSS source (Vitest blanks CSS imports, so read from disk).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'plugins.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rules(): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

describe('plugins CSS', () => {
  it('uses only the pl- prefix (or the bare root class), plus the shared mono helper', () => {
    expect(rules().length).toBeGreaterThan(10);
    for (const [sel] of rules()) {
      if (sel.startsWith('@')) continue;
      for (const cls of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        const c = cls[1] ?? '';
        expect(c.startsWith('pl-') || c === 'pl' || c === 'mono', `.${c} in ${sel}`).toBe(true);
      }
    }
  });

  it('takes colours from the tokens only', () => {
    for (const [sel, decl] of rules()) {
      expect(decl, sel).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i);
    }
  });

  it('never fades anything: no opacity, no filters', () => {
    for (const [sel, decl] of rules()) expect(decl, sel).not.toMatch(/opacity\s*:|filter\s*:/);
  });
});
