// What consumerIssues blocks: only what APISIX 3.20 refuses in a consumer (the `consumer` schema in
// apisix/schema_def.lua and check_conf in apisix/admin/consumers.lua). Each case was checked on the
// dev APISIX.
import { describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { pluginFixture } from '../../test/pluginFixture';
import { consumerIssues } from './validate';

const CTX = ctxOf({ consumerGroups: [itemOf('partners', { name: 'partners', plugins: {} }), itemOf('5', { plugins: {} })] });
const env = { isNew: false, ctx: CTX, plugins: pluginFixture().http };
const issues = (draft: Obj, e = env) => consumerIssues(draft, e).map((i) => [i.path, i.message]);
const paths = (draft: Obj, e = env) => consumerIssues(draft, e).map((i) => i.path);

describe('consumerIssues', () => {
  it('a consumer needs only a username', () => {
    expect(issues({ username: 'jo' })).toEqual([]);
    const full = { username: 'jo_e-1', desc: 'Jo', labels: { team: 'a' }, group_id: 'partners', plugins: { 'key-auth': { key: 'k' }, 'limit-count': { count: 1, time_window: 1 } } };
    expect(issues(full)).toEqual([]);
  });

  it('username: required (schema_def.lua `required = {"username"}`)', () => {
    expect(issues({})).toEqual([['username', t('cs.issue.username')]]);
    expect(issues({ username: '' })).toEqual([['username', t('cs.issue.username')]]);
  });

  it("username: letters, digits, - and _ only, at most 256 (the schema's pattern and rule_name_def)", () => {
    for (const bad of ['jo e', 'jo.e', 'jö', 'a/b']) expect(issues({ username: bad }), bad).toEqual([['username', t('cs.issue.usernamePattern')]]);
    expect(issues({ username: 'a'.repeat(256) })).toEqual([]);
    expect(issues({ username: 'a'.repeat(257) })).toEqual([['username', t('cs.issue.usernameLong')]]);
    expect(issues({ username: 5 })).toEqual([['username', t('cs.issue.usernamePattern')]]);
  });

  it('group_id: a group that exists, once the groups have loaded (admin/consumers.lua 47–62)', () => {
    expect(issues({ username: 'jo', group_id: 'nope' })).toEqual([['group_id', t('cs.issue.missingGroup', { id: 'nope' })]]);
    expect(issues({ username: 'jo', group_id: 'nope' }, { ...env, ctx: ctxOf({ loaded: { consumerGroups: false } }) })).toEqual([]);
    // An integer id is an id too (id_schema); it names the group stored under "5".
    expect(issues({ username: 'jo', group_id: 5 })).toEqual([]);
  });

  it("group_id: the id schema's shapes (a string of letters, digits, - _ . up to 64, or an integer ≥ 1)", () => {
    for (const bad of ['a b', 0, true, {}]) expect(paths({ username: 'jo', group_id: bad }), JSON.stringify(bad)).toEqual(['group_id']);
  });

  it('label values: non-empty, no spaces; an empty table is fine', () => {
    expect(paths({ username: 'jo', labels: { team: 'a b' } })).toEqual(['labels']);
    expect(issues({ username: 'jo', labels: [] })).toEqual([]);
  });

  it('plugins: an object (an empty table is one), checked against the consumer schemas', () => {
    expect(issues({ username: 'jo', plugins: [] })).toEqual([]);
    expect(paths({ username: 'jo', plugins: ['key-auth'] })).toEqual(['plugins']);
    expect(issues({ username: 'jo', plugins: { 'key-auth': {} } })).toEqual([['plugins.key-auth.key', t('schema.required')]]);
    // Auth plugins next to credentials are fine: APISIX does not refuse them (admin/consumers.lua).
    expect(issues({ username: 'jo', plugins: { 'basic-auth': { username: 'u', password: 'p' } } })).toEqual([]);
  });
});
