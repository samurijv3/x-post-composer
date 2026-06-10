import { describe, expect, it } from 'vitest';
import { formatRelativeTweetTime } from './relativeTime';

const NOW = Date.parse('2026-06-09T12:00:00Z');

describe('formatRelativeTweetTime', () => {
  it('returns null for null input', () => {
    expect(formatRelativeTweetTime(null, NOW)).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(formatRelativeTweetTime('not-a-date', NOW)).toBeNull();
  });

  it('returns "now" for under one minute ago', () => {
    expect(formatRelativeTweetTime('2026-06-09T11:59:45Z', NOW)).toBe('now');
  });

  it('returns "now" when timestamp is in the future (clock skew)', () => {
    expect(formatRelativeTweetTime('2026-06-09T12:00:30Z', NOW)).toBe('now');
  });

  it('returns minutes for < 1h', () => {
    expect(formatRelativeTweetTime('2026-06-09T11:55:00Z', NOW)).toBe('5m');
    expect(formatRelativeTweetTime('2026-06-09T11:01:00Z', NOW)).toBe('59m');
  });

  it('returns hours for < 24h', () => {
    expect(formatRelativeTweetTime('2026-06-09T09:00:00Z', NOW)).toBe('3h');
    expect(formatRelativeTweetTime('2026-06-08T13:00:00Z', NOW)).toBe('23h');
  });

  it('returns "Mon d" for same-year older than 24h', () => {
    expect(formatRelativeTweetTime('2026-04-05T10:00:00Z', NOW)).toBe('Apr 5');
    expect(formatRelativeTweetTime('2026-01-15T10:00:00Z', NOW)).toBe('Jan 15');
  });

  it('returns "Mon d, yyyy" for different-year', () => {
    expect(formatRelativeTweetTime('2024-04-05T10:00:00Z', NOW)).toBe('Apr 5, 2024');
    expect(formatRelativeTweetTime('2023-12-31T10:00:00Z', NOW)).toBe('Dec 31, 2023');
  });
});
