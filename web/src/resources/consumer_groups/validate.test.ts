// What consumerGroupIssues blocks: only what APISIX 3.20 refuses in a consumer group (the
// `consumer_group` schema in apisix/schema_def.lua and check_conf in apisix/admin/consumer_group.lua).
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import { consumerGroupIssues } from './validate';

const env = { isNew: false, ctx: ctxOf(), plugins: pluginFixture().http };
const issues = (draft: Obj) => consumerGroupIssues(draft, env).map((i) => [i.path, i.message]);

describe('consumerGroupIssues', () => {
  it('a group with a plugins list, even an empty one, has no issue', () => {
    expect(issues({ plugins: {} })).toEqual([]);
    expect(issues({ plugins: [] })).toEqual([]);
    expect(issues({ name: 'p', desc: 'd', labels: { tier: 'a' }, plugins: { 'limit-count': { count: 1, time_window: 60 } } })).toEqual([]);
  });

  it('plugins is required, and an object (schema_def.lua consumer_group: required = {"id", "plugins"})', () => {
    expect(issues({ name: 'p' })).toEqual([['plugins', t('cg.issue.plugins')]]);
    expect(issues({ plugins: 'x' })).toEqual([['plugins', t('cg.issue.plugins')]]);
  });

  it("each plugin against its route-side schema (admin/consumer_group.lua passes no schema type)", () => {
    expect(issues({ plugins: { 'limit-count': {} } }).map(([path]) => path)).toEqual(['plugins.limit-count.count', 'plugins.limit-count.time_window']);
    expect(issues({ plugins: { nope: {} } })).toEqual([['plugins.nope', t('pl.issue.unknown')]]);
  });

  it('label values', () => {
    expect(issues({ plugins: {}, labels: { tier: 'a b' } })).toEqual([['labels', t('rt.issue.labels')]]);
  });
});
