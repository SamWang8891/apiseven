// What credentialIssues blocks: only what APISIX 3.20 refuses in a credential (the `credential`
// schema in apisix/schema_def.lua and check_conf in apisix/admin/credentials.lua), checked live.
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import { credentialIssues } from './validate';

const env = { isNew: false, ctx: ctxOf(), plugins: pluginFixture().http };
const issues = (draft: Obj) => credentialIssues(draft, env).map((i) => [i.path, i.message]);

describe('credentialIssues', () => {
  it('one auth plugin with its config: no issue', () => {
    expect(issues({ id: 'c1', name: 'c1', desc: 'd', labels: { a: 'b' }, plugins: { 'key-auth': { key: 'k' } } })).toEqual([]);
  });

  it('no plugin at all is stored by APISIX (no minProperties, nothing required), so it is not blocked', () => {
    expect(issues({ id: 'c1' })).toEqual([]);
    expect(issues({ id: 'c1', plugins: {} })).toEqual([]);
    expect(issues({ id: 'c1', plugins: [] })).toEqual([]);
  });

  it('two plugins: refused (schema_def.lua credential plugins maxProperties 1)', () => {
    expect(issues({ plugins: { 'key-auth': { key: 'k' }, 'basic-auth': { username: 'u', password: 'p' } } })).toEqual([['plugins', t('cr.issue.onePlugin')]]);
  });

  it('a plugin that is not an auth plugin, or one this APISIX lacks (admin/credentials.lua 33–45)', () => {
    expect(issues({ plugins: { 'limit-count': { count: 1, time_window: 1 } } })).toEqual([['plugins.limit-count', t('pl.issue.credentialAuth')]]);
    expect(issues({ plugins: { nope: {} } })).toEqual([['plugins.nope', t('pl.issue.unknown')]]);
  });

  it("the plugin's consumer schema: a key-auth without its key", () => {
    expect(issues({ plugins: { 'key-auth': {} } })).toEqual([['plugins.key-auth.key', t('schema.required')]]);
  });

  it('plugins must be an object; label values non-empty without spaces', () => {
    expect(issues({ plugins: 'key-auth' })).toEqual([['plugins', t('cr.issue.pluginsObject')]]);
    expect(issues({ labels: { a: '' } })).toEqual([['labels', t('rt.issue.labels')]]);
  });
});
