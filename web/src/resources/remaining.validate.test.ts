// What the Task 15 kinds' checks block: only what APISIX 3.20 refuses (each case names the line).
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { ctxOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { globalRuleIssues } from './global_rules/validate';
import { metadataIdProblem, metadataIssues } from './plugin_metadata/validate';
import { pluginConfigIssues } from './plugin_configs/validate';
import { characters, CONTENT_MAX } from './protos/content';
import { protoIssues } from './protos/validate';
import type { ValidateEnv } from './registry';
import { secretIdProblem, secretIssues } from './secrets/validate';

const env = (id?: string): ValidateEnv => ({ isNew: false, ctx: ctxOf(), plugins: pluginFixture().http, id });
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('globalRuleIssues (schema_def.lua 1021–1034, admin/global_rules.lua 48–57)', () => {
  it('plugins is required and an object; an empty table is one', () => {
    expect(globalRuleIssues({ plugins: {} }, env())).toEqual([]);
    expect(globalRuleIssues({ plugins: [] }, env())).toEqual([]);
    expect(globalRuleIssues({}, env())).toEqual([{ path: 'plugins', message: t('gr.issue.plugins'), tab: 'plugins' }]);
    expect(paths(globalRuleIssues({ plugins: ['x'] }, env()))).toEqual(['plugins']);
  });

  it('each plugin against its schema; a switched-off one is not schema-checked (plugin.lua 1033–1046)', () => {
    expect(paths(globalRuleIssues({ plugins: { 'http-logger': {} } }, env()))).toEqual(['plugins.http-logger.uri']);
    expect(globalRuleIssues({ plugins: { 'http-logger': { _meta: { disable: true } } } }, env())).toEqual([]);
    expect(paths(globalRuleIssues({ plugins: { nope: {} } }, env()))).toEqual(['plugins.nope']);
  });
});

describe('pluginConfigIssues (schema_def.lua 1156–1174, admin/plugin_config.lua 27–39)', () => {
  it('plugins is required and an object; name is any text, even empty; labels as everywhere', () => {
    expect(pluginConfigIssues({ name: '', plugins: {} }, env())).toEqual([]);
    expect(paths(pluginConfigIssues({ name: 'n' }, env()))).toEqual(['plugins']);
    expect(paths(pluginConfigIssues({ name: 3, plugins: {} }, env()))).toEqual(['name']);
    expect(paths(pluginConfigIssues({ plugins: {}, labels: { a: 'b c' } }, env()))).toEqual(['labels']);
    expect(pluginConfigIssues({ plugins: {}, labels: [] }, env())).toEqual([]);
    expect(paths(pluginConfigIssues({ plugins: { 'limit-count': {} } }, env()))).toEqual(['plugins.limit-count.count', 'plugins.limit-count.time_window']);
  });
});

describe('protoIssues (schema_def.lua 1000–1018)', () => {
  it('content is required, text, 1 to 1,048,576 characters (counted as UTF-8 characters)', () => {
    expect(protoIssues({ content: 'syntax = "proto3";' })).toEqual([]);
    expect(protoIssues({})).toEqual([{ path: 'content', message: t('pr.issue.content') }]);
    expect(protoIssues({ content: '' })).toEqual([{ path: 'content', message: t('pr.issue.content') }]);
    expect(protoIssues({ content: 3 })).toEqual([{ path: 'content', message: t('pr.issue.contentText') }]);
    expect(protoIssues({ content: 'a'.repeat(CONTENT_MAX) })).toEqual([]);
    expect(protoIssues({ content: 'a'.repeat(CONTENT_MAX + 1) })).toEqual([{ path: 'content', message: t('pr.issue.contentLength') }]);
    // Two UTF-16 units, one character: the validator counts characters (jsonschema.lua utf8_len).
    expect(characters('😀'.repeat(3))).toBe(3);
    expect(protoIssues({ content: '😀'.repeat(CONTENT_MAX) })).toEqual([]);
  });

  it('labels as everywhere; whether the content compiles is APISIX’s to say', () => {
    expect(paths(protoIssues({ content: 'not a proto at all', labels: { a: '' } }))).toEqual(['labels']);
  });
});

describe('secretIssues (admin/secrets.lua 35–38, apisix/secret/*.lua)', () => {
  const VAULT: Obj = { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 't' };
  it("checks the draft (its id left out) against the id's manager schema, on the Settings tab", () => {
    expect(secretIssues({ id: 'vault/v', ...VAULT }, env('vault/v'))).toEqual([]);
    expect(secretIssues({ ...VAULT, extra: 1 }, env('vault/v'))).toEqual([]);
    expect(secretIssues({ prefix: 'p' }, env('vault/v')).map((i) => [i.path, i.tab])).toEqual([
      ['uri', 'config'],
      ['token', 'config'],
    ]);
    expect(paths(secretIssues({ ...VAULT, uri: 'no-scheme' }, env('vault/v')))).toEqual(['uri']);
    expect(secretIssues({ access_key_id: 'a', secret_access_key: 's' }, env('aws/a'))).toEqual([]);
    expect(paths(secretIssues({ access_key_id: 'a', secret_access_key: 's', endpoint_url: 'x' }, env('aws/a')))).toEqual(['endpoint_url']);
    expect(secretIssues({ auth_file: '/etc/gcp.json' }, env('gcp/g'))).toEqual([]);
    expect(secretIssues({ auth_config: { client_email: 'a@b.c', private_key: 'k', project_id: 'p' } }, env('gcp/g'))).toEqual([]);
    expect(paths(secretIssues({ auth_config: { client_email: 'a@b.c' } }, env('gcp/g')))).toEqual(['auth_config.private_key', 'auth_config.project_id']);
    expect(secretIssues({ anything: 1 }, env(undefined))).toEqual([]);
    expect(secretIssues({ anything: 1 }, env('nope/x'))).toEqual([]);
  });

  it('an empty table passes as either a list or an object, as in APISIX (gcp scope [] or {})', () => {
    const conf = { auth_config: { client_email: 'a@b.c', private_key: 'k', project_id: 'p', scope: {} } };
    expect(secretIssues(conf, env('gcp/g'))).toEqual([]);
    expect(paths(secretIssues({ auth_config: { ...conf.auth_config, scope: { a: 1 } } }, env('gcp/g')))).toEqual(['auth_config.scope']);
  });

  it('the id: a manager APISIX has, an id after it, and no slash in that id (APISIX keeps only the first segment, resource.lua 44–52)', () => {
    expect(secretIdProblem('vault/a')).toBeUndefined();
    expect(secretIdProblem('vault/a b')).toBeUndefined();
    expect(secretIdProblem('nope/a')).toBe(t('sc.id.noManager'));
    expect(secretIdProblem('/a')).toBe(t('sc.id.noManager'));
    expect(secretIdProblem('vault/')).toBe(t('sc.id.empty'));
    expect(secretIdProblem('vault/a/b')).toBe(t('sc.id.slash', { id: 'a/b' }));
  });
});

describe('metadataIssues (admin/plugin_metadata.lua 49–78)', () => {
  it("checks the draft (its id left out) against the plugin's metadata schema, on the Settings tab", () => {
    expect(metadataIssues({ id: 'http-logger', log_format: { host: '$host' } }, env('http-logger'))).toEqual([]);
    expect(metadataIssues({ max_pending_entries: 0 }, env('http-logger')).map((i) => [i.path, i.tab])).toEqual([['max_pending_entries', 'config']]);
    expect(paths(metadataIssues({ model: 'm' }, env('authz-casbin')))).toEqual(['policy']);
  });

  it('an empty table passes as an object (log_format: [])', () => {
    expect(metadataIssues({ log_format: [] }, env('http-logger'))).toEqual([]);
    expect(paths(metadataIssues({ log_format: ['a'] }, env('http-logger')))).toEqual(['log_format']);
  });

  it('nothing for a plugin the list lacks, one without a metadata schema, or before the list loads: APISIX decides', () => {
    expect(metadataIssues({ anything: 1 }, env('my-custom'))).toEqual([]);
    expect(metadataIssues({ anything: 1 }, env('key-auth'))).toEqual([]);
    expect(metadataIssues({ max_pending_entries: 0 }, { isNew: false, ctx: ctxOf(), id: 'http-logger' })).toEqual([]);
  });

  it('an id with a slash names no plugin', () => {
    expect(metadataIdProblem('http-logger')).toBeUndefined();
    expect(metadataIdProblem('a/b')).toBe(t('pm.issue.slash', { id: 'a/b' }));
  });
});
