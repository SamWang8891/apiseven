// A consumer's, credential's or group's plugin chips: what "off" and auth plugins mean there, and
// nothing definite about a plugin that can't be classified yet.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { pluginFixture } from '../test/pluginFixture';
import { PluginChips } from './cells';
import { scopedPlugins } from './scopedPlugins';

const off = { _meta: { disable: true } };
const myAuth = { schema: {}, type: 'auth', consumer_schema: { type: 'object' } };

describe('scopedPlugins', () => {
  it("a credential's plugins are all auth plugins (APISIX refuses others): no lookup, a custom one included", () => {
    const value = { plugins: { 'my-auth': { token: 't', ...off } } };
    expect(scopedPlugins(value, 'credential')).toEqual([{ name: 'my-auth', offIgnored: true }]);
    expect(scopedPlugins({ plugins: { 'key-auth': { key: 'k', ...off } } }, 'credential')).toEqual([{ name: 'key-auth', stillSignsIn: true }]);
  });

  it('stored off without the field it matches by, it signs nobody in: plainly off, never "still signs in"', () => {
    expect(scopedPlugins({ plugins: { 'key-auth': off } }, 'credential')).toEqual([{ name: 'key-auth', disabled: true }]);
    expect(scopedPlugins({ plugins: { 'basic-auth': { password: 'p', ...off } } }, 'consumer')).toEqual([{ name: 'basic-auth', disabled: true }]);
  });

  it("a consumer's plugin that is not built in, before the plugin list has loaded: unclassified, neither off nor still signing in", () => {
    const value = { plugins: { 'my-auth': { token: 't', ...off }, 'my-other': {}, 'limit-count': off } };
    expect(scopedPlugins(value, 'consumer')).toEqual([
      { name: 'limit-count', disabled: true },
      { name: 'my-auth', disabled: true, unclassified: true },
      { name: 'my-other', disabled: false, unclassified: true },
    ]);
    // Once loaded, the list decides.
    const all = { ...pluginFixture().http, 'my-auth': myAuth, 'my-other': { schema: {} } };
    expect(scopedPlugins(value, 'consumer', all)).toEqual([
      { name: 'limit-count', disabled: true },
      { name: 'my-auth', offIgnored: true },
      { name: 'my-other', disabled: false },
    ]);
  });

  it("a group's plugin that is not built in, before the list loads: unclassified, not marked as skipped", () => {
    expect(scopedPlugins({ plugins: { 'my-auth': {} } }, 'consumer_group')).toEqual([{ name: 'my-auth', disabled: false, unclassified: true }]);
    expect(scopedPlugins({ plugins: { 'my-auth': {} } }, 'consumer_group', { 'my-auth': myAuth })).toEqual([{ name: 'my-auth', disabled: false, notApplied: true }]);
  });

  it('the chips: an unclassified plugin stored off reads "marked off" and says why no more is shown; off ignored says so', () => {
    const { container } = render(<PluginChips plugins={[{ name: 'my-auth', disabled: true, unclassified: true }, { name: 'multi-auth', offIgnored: true }]} />);
    const chips = [...container.querySelectorAll('.cell-plugin')];
    expect(chips.map((c) => c.textContent)).toEqual([`my-auth${t('cell.plugin.markedOff')}`, `multi-auth${t('cell.plugin.offIgnored')}`]);
    expect(chips[0]).toHaveAttribute('title', `my-auth: ${t('cell.plugin.unclassifiedWhy')}`);
    expect(chips[1]).toHaveAttribute('title', `multi-auth: ${t('cell.plugin.offIgnoredWhy')}`);
    expect(container.textContent).not.toContain(t('cell.plugin.stillSignsIn'));
  });
});
