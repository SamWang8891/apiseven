import { describe, expect, it } from 'vitest';
import { issueAt, issuesByTab, issuesUnder, pathOfError, tabOfIssue, withinPath, type Issue } from './issues';

const issues: Issue[] = [
  { path: 'uri', message: 'Enter a URI' },
  { path: 'plugins.limit-count.count', message: 'must be > 0', tab: 'plugins' },
  { path: 'plugins.limit-count', message: 'unknown plugin', tab: 'plugins' },
  { path: 'plugins.limit-countx', message: 'other', tab: 'plugins' },
  { path: '', message: 'object-level' },
  { path: 'upstream.nodes.0.host', message: 'Enter a host' },
];

const tabs = [
  { id: 'general', fields: ['name', 'desc'] },
  { id: 'matching', fields: ['uri', 'uris', 'hosts'] },
  { id: 'upstream', fields: ['upstream', 'upstream_id'] },
  { id: 'plugins', fields: ['plugins'] },
];

describe('issueAt / issuesUnder / withinPath', () => {
  it('issueAt matches the exact path only', () => {
    expect(issueAt(issues, 'uri')).toBe('Enter a URI');
    expect(issueAt(issues, 'plugins.limit-count')).toBe('unknown plugin');
    expect(issueAt(issues, 'plugins')).toBeUndefined();
    expect(issueAt(issues, '')).toBe('object-level');
  });

  it('issuesUnder takes the path itself and everything below it, not siblings sharing a prefix', () => {
    expect(issuesUnder(issues, 'plugins.limit-count').map((i) => i.message)).toEqual(['must be > 0', 'unknown plugin']);
    expect(issuesUnder(issues, '')).toHaveLength(issues.length);
  });

  it('withinPath makes the paths relative to the prefix', () => {
    expect(withinPath(issues, 'upstream')).toEqual([{ path: 'nodes.0.host', message: 'Enter a host' }]);
    expect(withinPath(issues, 'plugins.limit-count').map((i) => i.path)).toEqual(['count', '']);
  });
});

describe('attribution', () => {
  it('uses issue.tab, else the tab owning the first path segment, else the fallback', () => {
    expect(tabOfIssue({ path: 'uri', message: '' }, tabs, 'json')).toBe('matching');
    expect(tabOfIssue({ path: 'upstream.nodes.0.host', message: '' }, tabs, 'json')).toBe('upstream');
    expect(tabOfIssue({ path: 'name', message: '', tab: 'plugins' }, tabs, 'json')).toBe('plugins');
    expect(tabOfIssue({ path: 'x_future', message: '' }, tabs, 'json')).toBe('json');
    expect(tabOfIssue({ path: '', message: '' }, tabs, 'json')).toBe('json');
  });

  it('a tab named by issue.tab that does not exist falls back too', () => {
    expect(tabOfIssue({ path: 'uri', message: '', tab: 'gone' }, tabs, 'json')).toBe('matching');
  });

  it('issuesByTab groups them', () => {
    const by = issuesByTab(issues, tabs, 'json');
    expect(by.get('matching')).toHaveLength(1);
    expect(by.get('plugins')).toHaveLength(3);
    expect(by.get('upstream')).toHaveLength(1);
    expect(by.get('json')).toHaveLength(1);
    expect(by.get('general')).toBeUndefined();
  });
});

describe('pathOfError: the draft path an APISIX save error is about', () => {
  // Every shape below is quoted from APISIX 3.20 (admin/*.lua, plugin.lua, upstream.lua, ssl.lua).
  const cases: [string, string][] = [
    ['invalid configuration: property "uri" validation failed: wrong type: expected string, got number', 'uri'],
    ['invalid configuration: property "upstream" validation failed: property "nodes" validation failed: expect array to have at least 1 items', 'upstream'],
    ['failed to check the configuration of plugin proxy-rewrite err: property "uri" validation failed: wrong type: expected string, got number', 'plugins.proxy-rewrite'],
    ['invalid plugins configuration: failed to check the configuration of plugin key-auth err: property "key" is required', 'plugins.key-auth'],
    ['failed to check the configuration of stream plugin [limit-conn]: property "conn" is required', 'plugins.limit-conn'],
    ['unknown plugin [no-such]', 'plugins.no-such'],
    ['unknown plugin no-such', 'plugins.no-such'],
    ['failed to fetch upstream info by upstream id [u9], response code: 404', 'upstream_id'],
    ['failed to fetch service info by service id [s9], response code: 404', 'service_id'],
    ['failed to fetch plugin config info by plugin config id [p9], response code: 404', 'plugin_config_id'],
    ['failed to fetch consumer group info by consumer group id [g9], response code: 404', 'group_id'],
    ["failed to validate the 'vars' expression: invalid operator 'nope'", 'vars'],
    ["failed to load 'filter_func' string: [string \"x\"]:1: unexpected symbol", 'filter_func'],
    ["'filter_func' should be a function", 'filter_func'],
    ["failed to load 'script' string: [string \"x\"]:1: unexpected symbol", 'script'],
    ["'script' should be a Lua object", 'script'],
    ['failed to parse cert: PEM_read_bio_X509_AUX() failed', 'cert'],
    ['failed to parse key: PEM_read_bio_PrivateKey() failed', 'key'],
    // An SSL's extra pairs and client CA (ssl.lua 123, 208, 217, 230): the SSL editor shows each field.
    ['failed to decrypt previous encrypted key', 'key'],
    ['mismatched number of certs and keys', 'keys'],
    ['failed to handle cert-key pair[1]: failed to parse cert: bad', 'certs.0'],
    ['failed to handle cert-key pair[2]: failed to parse key: PEM_read_bio_PrivateKey() failed', 'keys.1'],
    ['failed to handle cert-key pair[3]: failed to decrypt previous encrypted key', 'keys.2'],
    ['failed to validate client_cert: failed to parse cert: bad', 'client.ca'],
    // A stream route's (stream/router/ip_port.lua, stream/xrpc.lua, admin/stream_routes.lua).
    ['invalid remote_addr: fe80::/200', 'remote_addr'],
    ['invalid server_addr: :/8', 'server_addr'],
    ['unknown protocol [redis]', 'protocol.name'],
    ['stream route can not set itself as superior_id', 'protocol.superior_id'],
    ['failed to fetch stream routes[sr9], response code: 404', 'protocol.superior_id'],
    ['protocol mismatch: subordinate protocol [dubbo] does not match superior protocol [redis]', 'protocol.name'],
  ];
  for (const [message, path] of cases) {
    it(`${path} ← ${message.slice(0, 60)}`, () => expect(pathOfError(message)).toBe(path));
  }

  it('names no field when it is not sure: a property mentioned anywhere but at the start, two candidate fields, no field at all', () => {
    for (const message of [
      'only one of host or hosts is allowed',
      'only one of remote_addr or remote_addrs is allowed',
      'failed to check token: invalid method for role viewer',
      'wrong route id',
      'invalid configuration: value should match only one schema, but matches none',
      'something else: property "uri" validation failed',
      'invalid plugins configuration: plugin limit-count is not allowed here',
      '`upstream_host` can\'t be empty when `pass_host` is `rewrite`',
    ]) {
      expect(pathOfError(message), message).toBeUndefined();
    }
    expect(pathOfError(undefined)).toBeUndefined();
  });
});
