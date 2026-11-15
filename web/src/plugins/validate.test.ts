import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '../api/types';
import { t } from '../i18n';
import type { ValidateEnv } from '../resources/registry';
import { ctxOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { pluginIssues, validatePlugins } from './validate';

const { http, stream } = pluginFixture();
const env = (over: Partial<ValidateEnv> = {}): ValidateEnv => ({ isNew: false, ctx: ctxOf({}), plugins: http, streamPlugins: stream, ...over });

describe('validatePlugins', () => {
  it('a valid config has no issues; an empty one is fine for a plugin without required fields', () => {
    expect(validatePlugins({ 'limit-count': { count: 1, time_window: 60 }, 'key-auth': {}, cors: {} }, http, 'route')).toEqual([]);
  });

  // Task 16b item 64: APISIX stores and returns `{}` where a list is expected and `[]` where an object is (checked live:
  // resources/emptyTables.live.test.ts), as its validator takes an empty table for both: a stored config never blocks a save.
  it('an empty table passes as a list or an object, as APISIX takes it; a non-empty one of the other type does not', () => {
    expect(validatePlugins({ 'forward-auth': { uri: 'http://a.test', request_headers: {} }, 'file-logger': { path: 'logs/a.log', log_format: [] } }, http, 'route')).toEqual([]);
    expect(validatePlugins({ 'forward-auth': { uri: 'http://a.test', request_headers: { a: 1 } }, 'file-logger': { path: 'logs/a.log', log_format: ['x'] } }, http, 'route').map((i) => `${i.plugin}.${i.path}`)).toEqual([
      'forward-auth.request_headers',
      'file-logger.log_format',
    ]);
  });

  // Fix round 1, R4.1: an empty table is read as the type its position asks for, then checked as APISIX checks it
  // (both refused live: "expect array to have at least 1 items", "http_status is required"); [] and {} alike.
  it('an empty table read as the expected type still meets minItems and required, whichever of [] and {} it is', () => {
    for (const empty of [{}, []]) {
      expect(validatePlugins({ cors: { allow_origins_by_regex: empty } }, http, 'route').map((i) => `${i.plugin}.${i.path}`), JSON.stringify(empty)).toEqual(['cors.allow_origins_by_regex']);
      expect(validatePlugins({ 'fault-injection': { abort: empty } }, http, 'route').map((i) => `${i.plugin}.${i.path} ${i.message}`), JSON.stringify(empty)).toEqual([
        `fault-injection.abort.http_status ${t('schema.required')}`,
      ]);
    }
  });

  it('flags a wrong type at the field', () => {
    expect(validatePlugins({ 'limit-count': { count: 1, time_window: 60, rejected_code: 'teapot' } }, http, 'route')).toEqual([
      { plugin: 'limit-count', path: 'rejected_code', message: 'must be integer' },
    ]);
    // count is `oneOf [integer > 0, string]` on 3.20: the integer side's complaint is the one shown.
    expect(validatePlugins({ 'limit-count': { count: -1, time_window: 60 } }, http, 'route')).toEqual([
      { plugin: 'limit-count', path: 'count', message: 'must be > 0' },
    ]);
  });

  it("flags {count: 'x'} (the brief's case); on 3.20 a string count is a variable, so what is missing is time_window", () => {
    expect(validatePlugins({ 'limit-count': { count: 'x' } }, http, 'route')).toEqual([
      { plugin: 'limit-count', path: 'time_window', message: 'Required' },
    ]);
  });

  it('points a missing required field at its path', () => {
    expect(validatePlugins({ 'limit-count': {} }, http, 'route')).toEqual([
      { plugin: 'limit-count', path: 'count', message: 'Required' },
      { plugin: 'limit-count', path: 'time_window', message: 'Required' },
    ]);
  });

  it('a nested path is dotted', () => {
    const issues = validatePlugins({ 'proxy-rewrite': { headers: { set: true } } }, http, 'route');
    expect(issues).toEqual([{ plugin: 'proxy-rewrite', path: 'headers.set', message: 'must be object' }]);
  });

  it('a plugin this APISIX has not loaded: one issue at the root', () => {
    expect(validatePlugins({ 'no-such-plugin': { a: 1 } }, http, 'route')).toEqual([{ plugin: 'no-such-plugin', path: '', message: 'not loaded on this APISIX' }]);
  });

  it('uses the consumer schema on a consumer: key-auth needs a key there, not on a route', () => {
    expect(validatePlugins({ 'key-auth': {} }, http, 'consumer')).toEqual([{ plugin: 'key-auth', path: 'key', message: 'Required' }]);
    expect(validatePlugins({ 'key-auth': {} }, http, 'route')).toEqual([]);
  });

  it('a stream route is checked against the stream set', () => {
    expect(validatePlugins({ 'limit-conn': { conn: 1 } }, stream, 'stream_route').map((i) => i.path)).toEqual(expect.arrayContaining(['burst']));
    expect(validatePlugins({ 'proxy-rewrite': {} }, stream, 'stream_route')).toEqual([{ plugin: 'proxy-rewrite', path: '', message: 'not loaded on this APISIX' }]);
  });

  it('_meta is not an additional property for a schema that forbids them and does not declare _meta', () => {
    const strict: Record<string, PluginInfo> = {
      strict: { schema: { type: 'object', properties: { a: { type: 'integer' } }, additionalProperties: false } },
    };
    expect(validatePlugins({ strict: { a: 1, _meta: { disable: true } } }, strict, 'route')).toEqual([]);
    expect(validatePlugins({ strict: { a: 1, b: 2 } }, strict, 'route')).toEqual([{ plugin: 'strict', path: '', message: 'must NOT have additional property "b"' }]);
    // The consumer schemas APISIX publishes carry no _meta either.
    expect(validatePlugins({ 'key-auth': { key: 'k', _meta: { disable: true } } }, http, 'consumer')).toEqual([]);
  });

  it('checks _meta where the schema declares it (APISIX injects it into every plugin schema)', () => {
    expect(validatePlugins({ cors: { _meta: { priority: 'high' } } }, http, 'route')).toEqual([{ plugin: 'cors', path: '_meta.priority', message: 'must be integer' }]);
  });

  it('a schema Ajv cannot compile gives no issues (APISIX decides)', () => {
    const odd: Record<string, PluginInfo> = { odd: { schema: { type: 5 } } };
    expect(validatePlugins({ odd: { a: 1 } }, odd, 'route')).toEqual([]);
  });

  it('a credential holds only auth plugins', () => {
    expect(validatePlugins({ 'limit-count': { count: 1, time_window: 1 } }, http, 'credential')).toEqual([
      { plugin: 'limit-count', path: '', message: 'a credential holds only auth plugins' },
    ]);
  });
});

describe('a switched-off plugin (_meta.disable: true): APISIX does not check its settings (plugin.lua 1033–1046)', () => {
  const off = { _meta: { disable: true } };

  it('its schema errors are not issues, in every scope', () => {
    expect(validatePlugins({ 'limit-count': { ...off } }, http, 'route')).toEqual([]);
    expect(validatePlugins({ 'limit-count': { ...off, rejected_code: 'teapot' } }, http, 'consumer_group')).toEqual([]);
    expect(validatePlugins({ 'key-auth': { ...off } }, http, 'credential')).toEqual([]);
    expect(validatePlugins({ 'key-auth': { ...off } }, http, 'consumer')).toEqual([]);
    expect(validatePlugins({ 'limit-conn': { ...off } }, stream, 'stream_route')).toEqual([]);
  });

  it('switched on again, they are issues at once', () => {
    expect(validatePlugins({ 'limit-count': { _meta: { disable: false } } }, http, 'route').map((i) => i.path)).toEqual(['count', 'time_window']);
  });

  it('APISIX still refuses an unknown plugin and, in a credential, a plugin that is not auth', () => {
    expect(validatePlugins({ nope: { ...off } }, http, 'route')).toEqual([{ plugin: 'nope', path: '', message: t('pl.issue.unknown') }]);
    expect(validatePlugins({ 'limit-count': { ...off } }, http, 'credential')).toEqual([{ plugin: 'limit-count', path: '', message: t('pl.issue.credentialAuth') }]);
  });

  it('a config that is not an object is refused (plugin.lua 1011–1015): it cannot be marked off', () => {
    expect(validatePlugins({ 'limit-count': 'x' as unknown as Record<string, unknown> }, http, 'route').map((i) => i.path)).toEqual(['']);
  });

  it('APISIX still compiles _meta.filter and loads _meta.pre_function (plugin.lua 1048–1064): one that is not a list, or not text, is refused', () => {
    const bad = { _meta: { disable: true, filter: 'arg_x == 1', pre_function: 42 } };
    const issues = [
      { plugin: 'limit-count', path: '_meta.filter', message: t('pl.issue.filterOff') },
      { plugin: 'limit-count', path: '_meta.pre_function', message: t('pl.issue.preFunctionOff') },
    ];
    expect(validatePlugins({ 'limit-count': bad }, http, 'route')).toEqual(issues);
    expect(validatePlugins({ 'limit-count': bad }, http, 'consumer_group')).toEqual(issues);
    expect(validatePlugins({ 'key-auth': bad }, http, 'credential')).toEqual(issues.map((i) => ({ ...i, plugin: 'key-auth' })));
    // A list (or an object: a Lua table either way) and text pass here; APISIX compiles them on save.
    expect(validatePlugins({ 'limit-count': { _meta: { disable: true, filter: [['arg_x', '==', '1']], pre_function: 'return function() end' } } }, http, 'route')).toEqual([]);
    // false means none (Lua's `if filter then`).
    expect(validatePlugins({ 'limit-count': { _meta: { disable: true, filter: false } } }, http, 'route')).toEqual([]);
  });

  it("a stream route's switched-off plugin: not even those (stream_check_schema, plugin.lua 1335–1371)", () => {
    expect(validatePlugins({ 'limit-conn': { _meta: { disable: true, filter: 'x', pre_function: 1 } } }, stream, 'stream_route')).toEqual([]);
  });
});

describe('pluginIssues', () => {
  it('paths under plugins.<name>, on the plugins tab', () => {
    expect(pluginIssues({ plugins: { 'limit-count': { count: 1 } } }, env(), 'route')).toEqual([
      { path: 'plugins.limit-count.time_window', message: 'Required', tab: 'plugins' },
    ]);
    expect(pluginIssues({ plugins: { nope: {} } }, env(), 'route')).toEqual([{ path: 'plugins.nope', message: 'not loaded on this APISIX', tab: 'plugins' }]);
  });

  it('nothing while the plugin list has not loaded', () => {
    expect(pluginIssues({ plugins: { 'limit-count': {} } }, env({ plugins: undefined }), 'route')).toEqual([]);
    expect(pluginIssues({ plugins: { 'limit-conn': {} } }, env({ streamPlugins: undefined }), 'stream_route')).toEqual([]);
  });

  it('a stream route uses the stream set from the environment', () => {
    expect(pluginIssues({ plugins: { 'mqtt-proxy': {} } }, env(), 'stream_route').map((i) => i.path)).toEqual(['plugins.mqtt-proxy.protocol_level']);
  });

  it('nothing without plugins, or when plugins is not an object', () => {
    expect(pluginIssues({}, env(), 'route')).toEqual([]);
    expect(pluginIssues({ plugins: [] }, env(), 'route')).toEqual([]);
  });
});
