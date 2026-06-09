import { describe, expect, it } from 'vitest';
import { isBelowMinChars, isEmojiOnly, isSingleWord } from './predicates';

describe('isEmojiOnly', () => {
  it('returns true for a single emoji', () => {
    expect(isEmojiOnly('👋')).toBe(true);
  });

  it('returns true for multiple emoji with whitespace', () => {
    expect(isEmojiOnly('👋 🎉  🍕')).toBe(true);
  });

  it('returns true for flag emoji (regional indicators)', () => {
    expect(isEmojiOnly('🇺🇸')).toBe(true);
  });

  it('returns true for emoji with skin tone modifier', () => {
    expect(isEmojiOnly('👋🏽')).toBe(true);
  });

  it('returns true for ZWJ family sequence', () => {
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true);
  });

  it('returns false when text mixes emoji and letters', () => {
    expect(isEmojiOnly('👋 hello')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isEmojiOnly('hello world')).toBe(false);
  });

  it('returns false for empty / whitespace-only strings', () => {
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('   ')).toBe(false);
  });

  it('returns false when punctuation sneaks in', () => {
    expect(isEmojiOnly('👋!')).toBe(false);
  });
});

describe('isSingleWord', () => {
  it('returns true for one token', () => {
    expect(isSingleWord('hello')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isSingleWord('  hello  ')).toBe(true);
  });

  it('returns false for two tokens', () => {
    expect(isSingleWord('hello world')).toBe(false);
  });

  it('treats internal newlines and tabs as splitters', () => {
    expect(isSingleWord('hello\nworld')).toBe(false);
    expect(isSingleWord('a\tb')).toBe(false);
  });

  it('returns false for empty or whitespace-only input', () => {
    expect(isSingleWord('')).toBe(false);
    expect(isSingleWord('   ')).toBe(false);
  });

  it('counts punctuation as part of the word', () => {
    expect(isSingleWord("don't")).toBe(true);
  });
});

describe('isBelowMinChars', () => {
  it('returns true when trimmed length is below the minimum', () => {
    expect(isBelowMinChars('hi', 3)).toBe(true);
  });

  it('returns false when trimmed length meets the minimum', () => {
    expect(isBelowMinChars('hi!', 3)).toBe(false);
  });

  it('trims whitespace before measuring', () => {
    expect(isBelowMinChars('  hi  ', 3)).toBe(true);
  });

  it('returns true for empty input under any positive minimum', () => {
    expect(isBelowMinChars('', 1)).toBe(true);
  });
});
