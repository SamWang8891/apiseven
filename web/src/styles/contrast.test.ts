/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';

// WCAG 2.x relative luminance and contrast ratio for #rgb / #rrggbb colours.
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a #rgb/#rrggbb colour: ${hex}`);
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Custom properties declared directly in the first rule whose selector is exactly `selector`.
function declarations(css: string, selector: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(withoutComments); m; m = rule.exec(withoutComments)) {
    if (m[1]?.trim() !== selector) continue;
    const vars = new Map<string, string>();
    for (const d of (m[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (d[1] && d[2]) vars.set(d[1], d[2].trim());
    }
    return vars;
  }
  throw new Error(`no rule for selector ${selector} in tokens.css`);
}

const light = declarations(tokensCss, ':root');
const darkOverrides = declarations(tokensCss, ':root[data-theme="dark"]');
const themes = {
  light,
  // The dark rule sits on top of :root, so anything it doesn't override comes from :root.
  dark: new Map([...light, ...darkOverrides]),
};

const COLOR_TOKENS = [
  '--bg', '--bg-raised', '--bg-sunken', '--text', '--text-2', '--border', '--border-strong',
  '--accent', '--accent-text', '--ok', '--ok-bg', '--warn', '--warn-bg', '--danger', '--danger-bg',
  '--neutral-bg', '--focus', '--accent-bg', '--on-danger', '--code-key', '--code-string',
  '--code-literal', '--selection',
];
const OTHER_TOKENS = [
  '--font-sans', '--font-mono', '--radius', '--s1', '--s2', '--s3', '--s4', '--s5', '--s6',
];

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  ['--text', '--bg', 4.5],
  ['--text', '--bg-raised', 4.5],
  ['--text', '--bg-sunken', 4.5],
  ['--text-2', '--bg', 4.5],
  ['--text-2', '--bg-raised', 4.5],
  ['--accent-text', '--accent', 4.5],
  ['--ok', '--ok-bg', 4.5],
  ['--warn', '--warn-bg', 4.5],
  ['--danger', '--danger-bg', 4.5],
  ['--text', '--neutral-bg', 4.5],
  ['--border-strong', '--bg', 3],
];

// Further pairs the UI will use: secondary text in sunken table headers, accent links,
// state text and error messages on plain surfaces, focus rings against the page.
const MORE_PAIRS: [string, string, number][] = [
  ['--text-2', '--bg-sunken', 4.5],
  ['--accent', '--bg', 4.5],
  ['--accent', '--bg-raised', 4.5],
  ['--ok', '--bg', 4.5],
  ['--ok', '--bg-raised', 4.5],
  ['--warn', '--bg', 4.5],
  ['--warn', '--bg-raised', 4.5],
  ['--danger', '--bg', 4.5],
  ['--danger', '--bg-raised', 4.5],
  ['--border-strong', '--bg-raised', 3],
  ['--focus', '--bg', 3],
  ['--focus', '--bg-raised', 3],
];

// UI kit (web/src/ui): accent badges and highlighted options, solid danger buttons and count
// pills, and CodeMirror syntax colours on the editor surface and its gutter.
const KIT_PAIRS: [string, string, number][] = [
  ['--accent', '--accent-bg', 4.5],
  ['--text', '--accent-bg', 4.5],
  ['--text-2', '--accent-bg', 4.5],
  ['--on-danger', '--danger', 4.5],
  ['--code-key', '--bg-raised', 4.5],
  ['--code-string', '--bg-raised', 4.5],
  ['--code-literal', '--bg-raised', 4.5],
  ['--code-key', '--bg-sunken', 4.5],
  ['--code-string', '--bg-sunken', 4.5],
  ['--code-literal', '--bg-sunken', 4.5],
];

// Selected text keeps its colour on --selection (base.css ::selection, CodeMirror's selection layer):
// every text colour, syntax colours included (known item 15).
const SELECTION_PAIRS: [string, string, number][] = [
  '--text', '--text-2', '--accent', '--ok', '--warn', '--danger', '--code-key', '--code-string', '--code-literal',
].map((fg): [string, string, number] => [fg, '--selection', 4.5]);

// Light text on a solid fill would be unreadable on --selection, so what carries it can't be selected
// (fix round 1, R6.1): --accent-text and --on-danger on buttons (.ui-btn, which a primary link-button
// and a filter chip's count pill are or sit in), --on-danger on the tab and plugin-card problem pills,
// and a tooltip's --bg-raised text on --text. Checked below against the CSS.
const UNSELECTABLE: [file: string, selector: string][] = [
  ['ui/button.css', '.ui-btn'],
  ['ui/tabs.css', '.ui-tabs__badge'],
  ['plugins/plugins.css', '.pl-card__problems'],
  ['ui/overlay.css', '.ui-tooltip'],
];

// Shell and Connect page: the detail line of an error box is body text on the danger tint.
const SHELL_PAIRS: [string, string, number][] = [['--text', '--danger-bg', 4.5]];

// List cells (web/src/resources/cells.css): "off" on a filled plugin chip.
const CELL_PAIRS: [string, string, number][] = [['--text-2', '--neutral-bg', 4.5]];

describe('contrast()', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5); // 4.54, the classic AA grey
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5); // 4.48
  });
});

describe('what --selection would make unreadable', () => {
  it('can not be selected', () => {
    for (const [file, selector] of UNSELECTABLE) {
      const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const body = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => (m[1] ?? '').split(',').some((s) => s.trim() === selector))?.[2] ?? '';
      expect(body, `${file} ${selector}`).toMatch(/user-select:\s*none/);
    }
  });
});

describe('tokens.css', () => {
  it('defines every token under :root', () => {
    for (const name of [...COLOR_TOKENS, ...OTHER_TOKENS]) {
      expect(light.get(name), name).toBeTruthy();
    }
  });

  it('gives the dark theme its own value for every colour token', () => {
    for (const name of COLOR_TOKENS) {
      expect(darkOverrides.get(name), name).toBeTruthy();
    }
  });

  for (const [theme, vars] of Object.entries(themes)) {
    describe(`${theme} theme`, () => {
      for (const [fg, bg, min] of [...PAIRS, ...MORE_PAIRS, ...KIT_PAIRS, ...SELECTION_PAIRS, ...SHELL_PAIRS, ...CELL_PAIRS]) {
        it(`${fg} on ${bg} has contrast >= ${min}`, () => {
          const ratio = contrast(vars.get(fg) ?? 'missing', vars.get(bg) ?? 'missing');
          expect(ratio, `${fg} ${vars.get(fg)} on ${bg} ${vars.get(bg)}`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});
