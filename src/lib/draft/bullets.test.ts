import { describe, expect, it } from 'vitest';
import { applyBulletPrefixes, stripBulletPrefixes } from './bullets';

describe('applyBulletPrefixes', () => {
  it('prefixes every non-empty line with a real bullet', () => {
    expect(applyBulletPrefixes('one\ntwo')).toBe('• one\n• two');
  });

  it('leaves already-bulleted lines and empty lines alone', () => {
    expect(applyBulletPrefixes('• one\n\ntwo')).toBe('• one\n\n• two');
  });

  it('upgrades typed - and * markers to the real glyph', () => {
    expect(applyBulletPrefixes('- one\n* two')).toBe('• one\n• two');
  });

  it('handles empty input', () => {
    expect(applyBulletPrefixes('')).toBe('');
  });
});

describe('stripBulletPrefixes', () => {
  it('removes leading bullets from every line', () => {
    expect(stripBulletPrefixes('• one\n• two')).toBe('one\ntwo');
  });

  it('round-trips with apply', () => {
    expect(stripBulletPrefixes(applyBulletPrefixes('one\ntwo'))).toBe('one\ntwo');
  });

  it('leaves unbulleted text untouched', () => {
    expect(stripBulletPrefixes('plain prose here')).toBe('plain prose here');
  });
});
