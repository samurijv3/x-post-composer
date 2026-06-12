import { describe, expect, it } from 'vitest';
import type { Span } from './types';
import { describeViolations } from './describe';

function span(rule: Span['rule'], entry?: string): Span {
  return { start: 0, end: 1, rule, matchedText: 'x', ...(entry !== undefined ? { entry } : {}) };
}

describe('describeViolations', () => {
  it('returns empty string for no violations', () => {
    expect(describeViolations([])).toBe('');
  });

  it('counts structural rules, singular vs plural', () => {
    expect(describeViolations([span('emDash')])).toBe('an em dash');
    expect(describeViolations([span('emDash'), span('emDash')])).toBe('2 em dashes');
  });

  it('lists rules in a fixed order joined with middots', () => {
    const out = describeViolations([span('aiColon'), span('smartQuote'), span('emDash')]);
    expect(out).toBe('an em dash · a curly quote · a label-colon opener');
  });

  it('quotes banned words by entry, deduped case-insensitively, one mention per word', () => {
    const out = describeViolations([
      span('doNotSay', 'Leverage'),
      span('doNotSay', 'leverage'),
      span('doNotSay', 'synergy'),
    ]);
    expect(out).toBe('banned words “leverage”, “synergy”');
  });

  it('a single banned word reads singular and follows the structural rules', () => {
    const out = describeViolations([span('doNotSay', 'leverage'), span('staccato')]);
    expect(out).toBe('a staccato run (3+ short sentences) · banned word “leverage”');
  });
});
