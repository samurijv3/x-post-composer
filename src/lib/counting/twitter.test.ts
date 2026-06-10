import { describe, expect, it } from 'vitest';
import { isOver280, weightedLength, X_HARD_LIMIT } from './twitter';

describe('weightedLength', () => {
  it('matches JS length for plain ASCII', () => {
    expect(weightedLength('hello world')).toBe('hello world'.length);
  });

  it('counts a URL as 23 weighted characters regardless of its literal length', () => {
    // Per X's spec, any URL twitter-text recognises counts as 23.
    const short = weightedLength('https://x.io');
    const long = weightedLength(
      'https://example.com/path/to/a/much/longer/resource?with=query&plus=more',
    );
    expect(short).toBe(23);
    expect(long).toBe(23);
  });

  it('matches X for a URL-bearing tweet', () => {
    // "ship it " (8) + URL (23 weighted) = 31
    expect(weightedLength('ship it https://example.com/some-long-url-that-x-shortens')).toBe(31);
  });

  it('counts a single emoji as 2 weighted characters', () => {
    // Most emoji weigh 2 under X's table.
    expect(weightedLength('👋')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(weightedLength('')).toBe(0);
  });
});

describe('isOver280', () => {
  it('returns false for a 280-weight tweet', () => {
    const text = 'a'.repeat(280);
    expect(weightedLength(text)).toBe(280);
    expect(isOver280(text)).toBe(false);
  });

  it('returns true for a 281-weight tweet', () => {
    expect(isOver280('a'.repeat(281))).toBe(true);
  });

  it('returns true when a URL pushes the total past 280', () => {
    // 260 ASCII + 23 URL = 283
    const text = 'x'.repeat(260) + ' https://example.com';
    expect(isOver280(text)).toBe(true);
  });

  it('uses the X hard limit of 280', () => {
    expect(X_HARD_LIMIT).toBe(280);
  });
});
