import { describe, expect, it } from 'vitest';
import { matchesSearch } from './search';

describe('matchesSearch', () => {
  it('matches everything on an empty or whitespace-only query (search off)', () => {
    expect(matchesSearch('anything at all', '')).toBe(true);
    expect(matchesSearch('anything at all', '   ')).toBe(true);
  });

  it('substring-matches case-insensitively', () => {
    expect(matchesSearch('The validation calls can wait', 'VALID')).toBe(true);
    expect(matchesSearch('The validation calls can wait', 'tomorrow')).toBe(false);
  });

  it('requires EVERY token, in any order, anywhere (token-AND)', () => {
    const text = 'The validation calls can wait one more day. That’s the trap.';
    expect(matchesSearch(text, 'trap validation')).toBe(true);
    expect(matchesSearch(text, 'validation meeting')).toBe(false);
  });

  it('treats runs of whitespace as one separator', () => {
    expect(matchesSearch('day seven of building', 'day   building')).toBe(true);
  });

  it('matches across word boundaries (plain substring, no stemming)', () => {
    expect(matchesSearch('shipping small wins', 'ship')).toBe(true);
    expect(matchesSearch('shipping small wins', 'shipped')).toBe(false);
  });
});
