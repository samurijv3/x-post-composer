import { describe, expect, it } from 'vitest';
import { autoFix } from './autoFix';

const ALL_ON = { fixEmDash: true, fixSmartQuotes: true };

describe('autoFix', () => {
  it('leaves clean text untouched', () => {
    const out = autoFix('hello world', ALL_ON);
    expect(out.text).toBe('hello world');
    expect(out.appliedFixes).toEqual([]);
  });

  it('replaces a tight em dash with comma + space', () => {
    const out = autoFix('I went—you stayed', ALL_ON);
    expect(out.text).toBe('I went, you stayed');
    expect(out.appliedFixes).toHaveLength(1);
    expect(out.appliedFixes[0]?.rule).toBe('emDash');
  });

  it('replaces a spaced em dash and collapses the surrounding whitespace', () => {
    const out = autoFix('I went — you stayed', ALL_ON);
    expect(out.text).toBe('I went, you stayed');
  });

  it('converts all four smart quotes to straight quotes', () => {
    const out = autoFix('‘a’ “b”', ALL_ON);
    expect(out.text).toBe(`'a' "b"`);
    expect(out.appliedFixes).toHaveLength(4);
  });

  it('respects the fixEmDash toggle', () => {
    const out = autoFix('I went—you stayed', { fixEmDash: false, fixSmartQuotes: true });
    expect(out.text).toBe('I went—you stayed');
  });

  it('respects the fixSmartQuotes toggle', () => {
    const out = autoFix('“hi”', { fixEmDash: true, fixSmartQuotes: false });
    expect(out.text).toBe('“hi”');
  });

  it('applies both fix types in one pass', () => {
    const out = autoFix('She said “hi” — then left.', ALL_ON);
    expect(out.text).toBe(`She said "hi", then left.`);
  });

  it('does not duplicate the comma when em dash is at start of text', () => {
    const out = autoFix('—ok', ALL_ON);
    expect(out.text).toBe(', ok');
  });

  it('reports correct original spans for every applied fix', () => {
    const text = 'a—b';
    const out = autoFix(text, ALL_ON);
    expect(out.appliedFixes[0]?.start).toBe(1);
    expect(out.appliedFixes[0]?.end).toBe(2);
    expect(out.appliedFixes[0]?.matchedText).toBe('—');
  });
});
