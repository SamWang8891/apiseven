// Every field of APISIX's upstream schema has a home in the form, so a field a later APISIX adds
// fails here instead of being silently left out.
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { upstreamTabs } from '../resources/upstreams/tabs';
import { upstreamSchema } from '../test/upstreamSchema';
import { upstreamSections } from './sections';

/** Upstream fields no form shows, and why. */
const NOT_IN_FORM: Record<string, string> = {
  id: 'the editor’s ID field (new objects) and the URL; never edited in a form',
  create_time: 'set by APISIX; the editor strips it before saving',
  update_time: 'set by APISIX; the editor strips it before saving',
};

describe('upstream form coverage', () => {
  const properties = Object.keys(upstreamSchema().properties as Obj).sort();
  const general = upstreamTabs.find((tab) => tab.id === 'general')?.fields ?? [];
  const sections = upstreamSections.flatMap((s) => s.fields);

  it('reads the live schema fixture', () => {
    expect(properties).toContain('nodes');
    expect(properties.length).toBeGreaterThan(20);
  });

  it.each(properties)('%s has a section, the General tab, or a reason to be left out', (field) => {
    const homes = [...sections.filter((f) => f === field), ...general.filter((f) => f === field), ...(field in NOT_IN_FORM ? ['NOT_IN_FORM'] : [])];
    expect(homes, field).toHaveLength(1);
  });

  it('names no field the schema lacks', () => {
    for (const field of [...sections, ...general, ...Object.keys(NOT_IN_FORM)]) expect(properties, field).toContain(field);
  });

  it('gives the standalone editor a tab per section, after General', () => {
    expect(upstreamTabs.map((tab) => tab.id)).toEqual(['general', ...upstreamSections.map((s) => s.id)]);
    for (const s of upstreamSections) expect(upstreamTabs.find((tab) => tab.id === s.id)?.fields).toEqual(s.fields);
  });
});
