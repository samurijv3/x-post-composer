import { describe, expect, it } from 'vitest';
import { joinSegments, parseThreadSegments } from './parse';

describe('parseThreadSegments', () => {
  it('splits on a line containing only ---', () => {
    expect(parseThreadSegments('first post\n---\nsecond post\n---\nthird')).toEqual([
      'first post',
      'second post',
      'third',
    ]);
  });

  it('tolerates whitespace around the delimiter and longer dashes', () => {
    expect(parseThreadSegments('a\n ---  \nb\n-----\nc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps blank lines INSIDE a segment (only delimiter lines split)', () => {
    const seg = 'Hook line.\n\nThe development paragraph.';
    expect(parseThreadSegments(`${seg}\n---\nclose`)).toEqual([seg, 'close']);
  });

  it('drops empty segments (trailing delimiter, double delimiter)', () => {
    expect(parseThreadSegments('a\n---\n\n---\nb\n---\n')).toEqual(['a', 'b']);
  });

  it('strips accidental leading numbering, narrowly', () => {
    expect(parseThreadSegments('1/ first\n---\n2. second\n---\n3) third')).toEqual([
      'first',
      'second',
      'third',
    ]);
    // Legitimate openings survive: year, ratio mid-text, bare number line.
    expect(parseThreadSegments('2024 was the year everything changed')).toEqual([
      '2024 was the year everything changed',
    ]);
    expect(parseThreadSegments('10/10 would recommend')).toEqual(['10/10 would recommend']);
  });

  it('returns one segment when no delimiter exists (model ignored the format)', () => {
    expect(parseThreadSegments('just one long post with no breaks')).toEqual([
      'just one long post with no breaks',
    ]);
  });

  it('a --- inside a line does not split', () => {
    expect(parseThreadSegments('before --- after\n---\nnext')).toEqual([
      'before --- after',
      'next',
    ]);
  });
});

describe('joinSegments', () => {
  it('round-trips with parse for trimmed, non-empty, delimiter-free segments', () => {
    const segments = ['one\n\nwith inner blank', 'two', 'three with --- inline'];
    expect(parseThreadSegments(joinSegments(segments))).toEqual(segments);
  });

  it('joins with the canonical wire format', () => {
    expect(joinSegments(['a', 'b'])).toBe('a\n---\nb');
  });
});
