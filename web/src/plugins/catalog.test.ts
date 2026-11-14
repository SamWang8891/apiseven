import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { pluginFixture } from '../test/pluginFixture';
import { CATEGORIES, catalog } from './catalog';

describe('the generated plugin catalog', () => {
  it('lists its plugins in sorted order (a regenerated file diffs cleanly)', () => {
    const names = Object.keys(catalog);
    expect(names).toEqual([...names].sort());
  });

  it('files every plugin under a known category, with a description', () => {
    for (const [name, entry] of Object.entries(catalog)) {
      expect(CATEGORIES, name).toContain(entry.category);
      expect(entry.description.length, name).toBeGreaterThan(10);
      expect(entry.description, name).not.toMatch(/`|\]\(/);
    }
  });

  it('has a label for every category, and for Other', () => {
    for (const category of [...CATEGORIES, 'other']) expect(en[`pl.category.${category}`], category).toBeDefined();
  });

  it('covers every plugin APISIX 3.20 loads, except the internal ones the docs leave out', () => {
    const fixture = pluginFixture();
    const missing = [...Object.keys(fixture.http), ...Object.keys(fixture.stream)].filter((name) => !(name in catalog));
    expect(missing.sort()).toEqual(['ai', 'example-plugin']);
  });
});
