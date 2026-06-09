import { describe, expect, it } from 'vitest';
import { validateAuthor } from './validateAuthor';

describe('validateAuthor', () => {
  it('matches identical handles', () => {
    expect(validateAuthor('alice', 'alice')).toBe(true);
  });

  it('ignores case', () => {
    expect(validateAuthor('Alice', 'alice')).toBe(true);
    expect(validateAuthor('ALICE', 'alice')).toBe(true);
  });

  it('ignores a leading @ on either side', () => {
    expect(validateAuthor('@alice', 'alice')).toBe(true);
    expect(validateAuthor('alice', '@alice')).toBe(true);
    expect(validateAuthor('@alice', '@alice')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(validateAuthor('  alice  ', 'alice')).toBe(true);
  });

  it('rejects different handles', () => {
    expect(validateAuthor('alice', 'bob')).toBe(false);
  });

  it('rejects partial matches (no substring matching)', () => {
    expect(validateAuthor('alice', 'alicexyz')).toBe(false);
    expect(validateAuthor('alicexyz', 'alice')).toBe(false);
  });

  it('treats empty configured handle as a rejection (no implicit pass)', () => {
    expect(validateAuthor('alice', '')).toBe(false);
    expect(validateAuthor('alice', '   ')).toBe(false);
  });

  it('treats empty tweet handle as a rejection', () => {
    expect(validateAuthor('', 'alice')).toBe(false);
  });
});
