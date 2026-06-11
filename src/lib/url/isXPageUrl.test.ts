import { describe, expect, it } from 'vitest';
import { isXPageUrl } from './isXPageUrl';

describe('isXPageUrl', () => {
  it('accepts the four X hosts over https', () => {
    expect(isXPageUrl('https://x.com/home')).toBe(true);
    expect(isXPageUrl('https://www.x.com/alice/status/1')).toBe(true);
    expect(isXPageUrl('https://twitter.com/notifications')).toBe(true);
    expect(isXPageUrl('https://www.twitter.com/')).toBe(true);
  });

  it('rejects other sites, including lookalike subdomains', () => {
    expect(isXPageUrl('https://github.com/')).toBe(false);
    expect(isXPageUrl('https://x.com.evil.example/')).toBe(false);
    expect(isXPageUrl('https://api.x.com/')).toBe(false);
  });

  it('rejects non-https schemes', () => {
    expect(isXPageUrl('http://x.com/')).toBe(false);
    expect(isXPageUrl('chrome-extension://abc/options.html')).toBe(false);
  });

  it('treats missing or unparseable URLs as not-on-X (chrome hides URLs we lack permission for)', () => {
    expect(isXPageUrl(undefined)).toBe(false);
    expect(isXPageUrl(null)).toBe(false);
    expect(isXPageUrl('')).toBe(false);
    expect(isXPageUrl('not a url')).toBe(false);
  });
});
