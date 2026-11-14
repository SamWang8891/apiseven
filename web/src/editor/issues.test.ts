import { describe, expect, it } from 'vitest';
import { issueAt, issuesByTab, issuesUnder, propertyOfError, tabOfIssue, withinPath, type Issue } from './issues';

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

describe('propertyOfError', () => {
  it('reads the first property APISIX names', () => {
    expect(propertyOfError('invalid configuration: property "uri" validation failed: wrong type: expected string, got number')).toBe('uri');
    expect(
      propertyOfError('invalid configuration: property "upstream" validation failed: property "nodes" validation failed: expect array to have at least 1 items'),
    ).toBe('upstream');
  });

  it('is undefined when no property is named', () => {
    expect(propertyOfError('failed to check token: invalid method for role viewer')).toBeUndefined();
    expect(propertyOfError(undefined)).toBeUndefined();
  });
});
