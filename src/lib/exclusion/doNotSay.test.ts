import { describe, expect, it } from 'vitest';
import { detectDoNotSay } from './doNotSay';

describe('detectDoNotSay', () => {
  it('returns no matches when no entries are listed', () => {
    expect(detectDoNotSay('delve into the realm', [])).toEqual([]);
  });

  it('matches a single word case-insensitively', () => {
    const spans = detectDoNotSay('We must Delve into this.', ['delve']);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.matchedText).toBe('Delve');
    expect(spans[0]?.entry).toBe('delve');
    expect(spans[0]?.rule).toBe('doNotSay');
  });

  it('matches as a WHOLE word — "art" does not match "start"', () => {
    expect(detectDoNotSay('I will start now.', ['art'])).toEqual([]);
  });

  it('matches as a WHOLE word — "art" matches "art" surrounded by punctuation', () => {
    const spans = detectDoNotSay('I love art!', ['art']);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.matchedText).toBe('art');
  });

  it('matches multi-word entries as a contiguous sequence', () => {
    const spans = detectDoNotSay('Let us delve into the tapestry.', ['delve into']);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.matchedText.toLowerCase()).toBe('delve into');
  });

  it('multi-word entries do NOT match across other words', () => {
    expect(detectDoNotSay('fine wine and modern art', ['fine art'])).toEqual([]);
  });

  it('reports every occurrence of an entry', () => {
    const spans = detectDoNotSay('delve here and delve there', ['delve']);
    expect(spans).toHaveLength(2);
  });

  it('reports matches for multiple entries simultaneously', () => {
    const spans = detectDoNotSay('Tapestry and delve.', ['delve', 'tapestry']);
    expect(spans.map((s) => s.entry).sort()).toEqual(['delve', 'tapestry']);
  });

  it('correctly identifies offsets into the original text', () => {
    const text = 'When we delve, we find tapestries.';
    const spans = detectDoNotSay(text, ['delve']);
    expect(spans[0]?.start).toBe(8);
    expect(spans[0]?.end).toBe(13);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('delve');
  });

  it('skips entries that tokenise to nothing', () => {
    expect(detectDoNotSay('some content here', ['', '   ', '!!!'])).toEqual([]);
  });

  it("keeps tokens with apostrophes intact (don't is one word)", () => {
    expect(detectDoNotSay("you don't say", ["don't"])).toHaveLength(1);
    // "don" alone should NOT match inside "don't"
    expect(detectDoNotSay("you don't say", ['don'])).toEqual([]);
  });

  it('matches across whitespace differences in multi-word entries', () => {
    expect(detectDoNotSay('in the realm of ideas', ['in   the realm'])).toHaveLength(1);
  });
});
