import { describe, expect, it } from 'vitest';
import { isPageOrigin } from './origin';

describe('isPageOrigin', () => {
  const page = 'http://127.0.0.1:8080/sub/index.html';

  it('is true for a relative base URL (apiseven behind a path)', () => {
    for (const baseUrl of ['', '/', '/proxy', 'proxy/', './']) expect(isPageOrigin(baseUrl, page)).toBe(true);
  });

  it("is true for an absolute base URL on the page's origin (what config.json's adminBase resolves to)", () => {
    for (const baseUrl of ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/', 'HTTP://127.0.0.1:8080/sub']) {
      expect(isPageOrigin(baseUrl, page)).toBe(true);
    }
  });

  it('is false for another origin: another host, port or scheme (APISIX itself)', () => {
    for (const baseUrl of ['http://127.0.0.1:9180', 'https://127.0.0.1:8080', 'http://localhost:8080', 'http://apisix:9180', '//evil.example']) {
      expect(isPageOrigin(baseUrl, page)).toBe(false);
    }
  });

  it('is false on a page without an origin of its own (file://), and for what is not a URL', () => {
    expect(isPageOrigin('', 'file:///Users/me/apiseven.html')).toBe(false);
    expect(isPageOrigin('http://127.0.0.1:19180', 'file:///Users/me/apiseven.html')).toBe(false);
    expect(isPageOrigin('http://[bad', page)).toBe(false);
  });

  it("defaults to this document's address", () => {
    expect(isPageOrigin(location.origin)).toBe(true);
    expect(isPageOrigin('http://apisix.test:9180')).toBe(false);
  });
});
