import { describe, expect, it } from 'vitest';
import { detectEmDash, detectSmartQuotes, detectStaccato } from './structural';

describe('detectEmDash', () => {
  it('returns no spans for plain text', () => {
    expect(detectEmDash('hello world')).toEqual([]);
  });

  it('flags a single em dash with correct offsets', () => {
    const text = 'I went—you stayed';
    const spans = detectEmDash(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(6);
    expect(spans[0]?.end).toBe(7);
    expect(spans[0]?.matchedText).toBe('—');
    expect(spans[0]?.rule).toBe('emDash');
  });

  it('flags every em dash in the string', () => {
    const text = 'a—b—c';
    expect(detectEmDash(text)).toHaveLength(2);
  });

  it('does NOT flag en dashes', () => {
    expect(detectEmDash('range 1–2')).toEqual([]);
  });

  it('does NOT flag hyphens', () => {
    expect(detectEmDash('well-known')).toEqual([]);
  });
});

describe('detectSmartQuotes', () => {
  it('flags all four curly quotes', () => {
    const text = '‘a’ “b”';
    const spans = detectSmartQuotes(text);
    expect(spans.map((s) => s.matchedText)).toEqual(['‘', '’', '“', '”']);
  });

  it('ignores straight quotes', () => {
    expect(detectSmartQuotes(`"a" 'b'`)).toEqual([]);
  });

  it('returns spans with width 1 each', () => {
    const text = '’';
    const spans = detectSmartQuotes(text);
    expect(spans[0]?.start).toBe(0);
    expect(spans[0]?.end).toBe(1);
  });
});

describe('detectStaccato', () => {
  it('does not flag normal prose', () => {
    const text = 'I went to the store and bought some apples. They were on sale today.';
    expect(detectStaccato(text)).toEqual([]);
  });

  it('does not flag two consecutive short sentences', () => {
    const text = 'Hi there. How are you?';
    expect(detectStaccato(text)).toEqual([]);
  });

  it('flags three consecutive ≤4-word sentences', () => {
    const text = 'Hi there. How are you? I am fine.';
    const spans = detectStaccato(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.rule).toBe('staccato');
    expect(spans[0]?.matchedText).toContain('Hi there');
    expect(spans[0]?.matchedText).toContain('I am fine');
  });

  it('flags longer runs and covers the whole span', () => {
    const text = 'One. Two. Three. Four. Five.';
    const spans = detectStaccato(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(0);
    expect(spans[0]?.end).toBeGreaterThan(text.length - 2);
  });

  it('breaks the run when a long sentence appears', () => {
    const text = 'Short one. Short two. This sentence has many more words in it. Short three.';
    expect(detectStaccato(text)).toEqual([]);
  });

  it('finds multiple separate staccato runs in the same text', () => {
    const text =
      'A. B. C. ' + 'Now a sentence with more than four words to break the run. ' + 'X. Y. Z.';
    const spans = detectStaccato(text);
    expect(spans).toHaveLength(2);
  });

  it('handles trailing sentence without terminator', () => {
    const text = 'One. Two. Three';
    const spans = detectStaccato(text);
    expect(spans).toHaveLength(1);
  });

  it('treats exactly 4 words as short, 5 as long', () => {
    const fourWord = 'I went to the. I went to the. I went to the.';
    expect(detectStaccato(fourWord)).toHaveLength(1);
    const fiveWord = 'I went to the store. I went to the store. I went to the store.';
    expect(detectStaccato(fiveWord)).toEqual([]);
  });

  it('does not flag empty text', () => {
    expect(detectStaccato('')).toEqual([]);
  });
});
