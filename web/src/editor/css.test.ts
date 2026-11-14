/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the editor frame's CSS source (Vitest blanks CSS imports, so read from disk).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rules(): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

const body = (selector: string) => rules().find(([sel]) => sel === selector)?.[1] ?? '';

describe('editor CSS', () => {
  it('uses only the ed- prefix (or the bare root class), plus the shared mono helper', () => {
    for (const [sel] of rules()) {
      for (const cls of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        const c = cls[1] ?? '';
        expect(c.startsWith('ed-') || c === 'ed' || c === 'mono', `.${c}`).toBe(true);
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

  it('marks editing with an overlaid bar, not a border that would move the page', () => {
    expect(body('.ed-head::after')).toMatch(/position:\s*absolute/);
    expect(body('.ed-head--editing::after')).toMatch(/background:\s*var\(--accent\)/);
    expect(body('.ed-head--editing')).toBe('');
    // The meta line keeps its height whether or not "Unsaved changes" shows.
    expect(body('.ed-meta')).toMatch(/min-height:\s*18px/);
  });

  it('keeps the header in view while the page scrolls', () => {
    expect(body('.ed-head')).toMatch(/position:\s*sticky/);
    expect(body('.ed-head')).toMatch(/top:\s*0/);
    expect(body('.ed-head')).toMatch(/background:\s*var\(--bg\)/);
  });
});
