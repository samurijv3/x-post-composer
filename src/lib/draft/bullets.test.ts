import { describe, expect, it } from 'vitest';
import { hasBulletLines, normalizeTypedBullets, stripBulletPrefixes } from './bullets';

describe('normalizeTypedBullets', () => {
  it('converts typed - and * line openers to the real glyph', () => {
    expect(normalizeTypedBullets('- one\n* two')).toBe('• one\n• two');
  });

  it('preserves indentation and is length-preserving (caret safety)', () => {
    const input = '  - indented';
    const output = normalizeTypedBullets(input);
    expect(output).toBe('  • indented');
    expect(output.length).toBe(input.length);
  });

  it('does not touch mid-line dashes, bare markers, or prose', () => {
    expect(normalizeTypedBullets('a - b')).toBe('a - b');
    expect(normalizeTypedBullets('-no space')).toBe('-no space');
    expect(normalizeTypedBullets('plain prose')).toBe('plain prose');
  });

  it('handles empty input', () => {
    expect(normalizeTypedBullets('')).toBe('');
  });
});

describe('hasBulletLines', () => {
  it('is true when any line starts with a bullet', () => {
    expect(hasBulletLines('• one')).toBe(true);
    expect(hasBulletLines('intro\n• point')).toBe(true);
    expect(hasBulletLines('  • indented')).toBe(true);
  });

  it('is false for prose and mid-line glyphs', () => {
    expect(hasBulletLines('plain prose')).toBe(false);
    expect(hasBulletLines('a • b')).toBe(false);
    expect(hasBulletLines('')).toBe(false);
  });
});

describe('stripBulletPrefixes', () => {
  it('removes leading bullets from every line', () => {
    expect(stripBulletPrefixes('• one\n• two')).toBe('one\ntwo');
  });

  it('round-trips with typed-marker normalization', () => {
    expect(stripBulletPrefixes(normalizeTypedBullets('- one\n- two'))).toBe('one\ntwo');
  });

  it('leaves unbulleted text untouched', () => {
    expect(stripBulletPrefixes('plain prose here')).toBe('plain prose here');
  });
});
