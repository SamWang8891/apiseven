/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checks on the UI kit's CSS source. Vitest blanks CSS imports, so the files are read from disk.
// A string, not `new URL(...)`: under jsdom the global URL class is not Node's.
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((name) => ({ name, css: readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

/** Removes `@keyframes name { … }` blocks, braces nested one level deep. */
function withoutKeyframes(css: string): string {
  return css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
}

/** [selector list, declarations] for every innermost rule. */
function rules(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [(m[1] ?? '').trim(), m[2] ?? '']);
}

describe('ui CSS', () => {
  it('exists', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('gives .ro-value the body text colour', () => {
    const roValue = files.flatMap((f) => rules(f.css)).filter(([sel]) => sel.split(',').some((s) => s.trim() === '.ro-value'));
    expect(roValue.length).toBeGreaterThan(0);
    expect(roValue.some(([, body]) => /(^|;|\s)color:\s*var\(--text\)\s*(;|$)/.test(body))).toBe(true);
    // ...and nothing else recolours it.
    for (const [sel, body] of files.flatMap((f) => rules(f.css))) {
      if (!sel.includes('.ro-value')) continue;
      const colour = /(?:^|[;\s])color:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (colour) expect(colour, sel).toBe('var(--text)');
    }
  });

  it('never lowers opacity outside an animation (opacity: 1, which undoes a browser default, is fine)', () => {
    for (const { name, css } of files) {
      const values = [...withoutKeyframes(css).matchAll(/(?:^|[;{\s])opacity\s*:\s*([^;}]+)/g)].map((m) => m[1]?.trim());
      for (const value of values) expect(value, name).toBe('1');
    }
  });

  it('never styles a locked, read-only or off state with opacity or filters', () => {
    for (const { name, css } of files) {
      for (const [sel, body] of rules(css)) {
        if (!/ro-value|locked|read-?only|unchecked|\boff\b|disabled/i.test(sel)) continue;
        expect(body, `${name}: ${sel}`).not.toMatch(/opacity\s*:\s*(?!1\s*(?:;|$))|filter\s*:|grayscale/);
      }
    }
  });

  it('uses only ui- prefixed classes, plus ro-value and the shared mono helper', () => {
    for (const { name, css } of files) {
      for (const [sel] of rules(withoutKeyframes(css))) {
        for (const cls of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          const c = cls[1] ?? '';
          if (c.startsWith('cm-')) continue; // CodeMirror's own classes, styled inside .ui-code
          expect(c.startsWith('ui-') || c.startsWith('ro-value') || c === 'mono', `${name}: .${c}`).toBe(true);
        }
      }
    }
  });

  // Fix round 1, F2: a tooltip only names its trigger; it never takes a click meant for a control under it.
  it('tooltips take no pointer events (nor their positioned wrapper), and sit above the toasts', () => {
    const all = files.flatMap((f) => rules(f.css));
    const body = (selector: string) => all.filter(([sel]) => sel.split(',').some((s) => s.trim() === selector)).map(([, b]) => b).join(';');
    expect(body('.ui-tooltip')).toMatch(/pointer-events:\s*none/);
    expect(body('[data-radix-popper-content-wrapper]:has(> .ui-tooltip)')).toMatch(/pointer-events:\s*none/);
    const z = (selector: string) => Number(/z-index:\s*(\d+)/.exec(body(selector))?.[1]);
    expect(z('.ui-tooltip')).toBeGreaterThan(z('.ui-toast-viewport'));
  });

  // Known item 16: base.css's global :focus-visible outline loads after the kit's CSS, so a field that
  // sits in a box which rings itself (:focus-within) must say "no outline" for :focus-visible too, or
  // it draws a second ring inside the box's.
  it("a busy switch keeps its state's colours: the disabled look leaves aria-busy out, and busy shows progress", () => {
    const toggle = rules(files.find((f) => f.name === 'toggle.css')?.css ?? '');
    const disabledLooks = toggle.filter(([sel]) => sel.includes('.ui-switch:disabled'));
    expect(disabledLooks.length).toBeGreaterThan(0);
    for (const [sel] of disabledLooks) {
      for (const one of sel.split(',').map((s) => s.trim()).filter((s) => s.startsWith('.ui-switch:disabled'))) {
        expect(one, sel).toContain(":not([aria-busy='true'])");
      }
    }
    const busy = toggle.find(([sel]) => sel === ".ui-switch[aria-busy='true']")?.[1] ?? '';
    expect(busy).toMatch(/cursor:\s*progress/);
    // A busy switch is aria-disabled, not :disabled (it keeps focus), so hover leaves it out, by
    // aria-disabled (which busy carries; an unavailable switch too) or by aria-busy.
    const hovers = toggle.filter(([sel]) => sel.includes('.ui-switch') && sel.includes(':hover'));
    expect(hovers.length).toBeGreaterThan(0);
    for (const [sel] of hovers) expect(sel).toMatch(/:not\([^)]*\[aria-(disabled|busy)='true'\]/);
  });

  it('a loading button is aria-disabled, so its hover leaves it out (by aria-disabled, which busy carries), and busy shows progress', () => {
    const button = rules(files.find((f) => f.name === 'button.css')?.css ?? '');
    const hovers = button.filter(([sel]) => sel.includes('.ui-btn') && sel.includes(':hover'));
    expect(hovers.length).toBeGreaterThan(0);
    for (const [sel] of hovers) expect(sel).toMatch(/:not\([^)]*\[aria-(disabled|busy)='true'\]/);
    expect(button.find(([sel]) => sel === ".ui-btn[aria-busy='true']")?.[1] ?? '').toMatch(/cursor:\s*progress/);
  });

  it('a field inside a box that rings itself draws no second ring', () => {
    const all = files.flatMap((f) => rules(f.css));
    for (const field of ['.ui-tags__input', '.ui-input__bare', '.ui-select__trigger']) {
      const covered = all.some(([sel, body]) => sel.split(',').some((s) => s.trim() === `${field}:focus-visible`) && /outline:\s*none/.test(body));
      expect(covered, field).toBe(true);
    }
  });
});
