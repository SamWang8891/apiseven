import { describe, expect, it } from 'vitest';
import { isMixedContent, normalizeAdminUrl } from './url';

describe('normalizeAdminUrl', () => {
  it.each([
    ['http://h:9180', 'http://h:9180'],
    ['  http://h:9180  ', 'http://h:9180'],
    ['http://h:9180/', 'http://h:9180'],
    ['http://h:9180///', 'http://h:9180'],
    ['http://h:9180/apisix/admin', 'http://h:9180'],
    ['http://h:9180/apisix/admin/', 'http://h:9180'],
    ['https://gw.example.com/proxy/apisix/admin/', 'https://gw.example.com/proxy'],
    ['HTTP://h:9180', 'HTTP://h:9180'],
    ['http://[::1]:9180/', 'http://[::1]:9180'],
  ])('%j becomes %j', (input, url) => {
    expect(normalizeAdminUrl(input)).toEqual({ url });
  });

  it('asks for a URL when there is none', () => {
    expect(normalizeAdminUrl('')).toEqual({ error: 'required' });
    expect(normalizeAdminUrl('   ')).toEqual({ error: 'required' });
  });

  it.each(['ftp://h:21', 'localhost:9180', 'h:9180', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'http://'])(
    'rejects %j',
    (input) => {
      expect(normalizeAdminUrl(input)).toEqual({ error: 'invalid' });
    },
  );
});

describe('isMixedContent', () => {
  it('is true only for an http URL from an https page', () => {
    expect(isMixedContent('http://h:9180', 'https:')).toBe(true);
    expect(isMixedContent('https://h:9180', 'https:')).toBe(false);
    expect(isMixedContent('http://h:9180', 'http:')).toBe(false);
    expect(isMixedContent('http://h:9180', 'file:')).toBe(false);
  });
});
