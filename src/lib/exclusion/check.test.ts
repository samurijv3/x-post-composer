import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../types';
import { checkExclusions, hasRepairableViolations } from './check';

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    structuralRules: {
      ...DEFAULT_SETTINGS.structuralRules,
      ...(overrides.structuralRules ?? {}),
    },
  };
}

describe('checkExclusions', () => {
  it('returns no violations for clean text under default settings', () => {
    const r = checkExclusions('A normal sentence with no issues.', settings());
    expect(r.violations).toEqual([]);
    expect(hasRepairableViolations(r)).toBe(false);
  });

  it('flags em dash + smart quote + do-not-say in one pass', () => {
    const text = `We will delve into this — it is “remarkable”.`;
    const r = checkExclusions(text, settings({ doNotSay: ['delve'] }));
    const rules = r.violations.map((v) => v.rule).sort();
    expect(rules).toContain('emDash');
    expect(rules).toContain('smartQuote');
    expect(rules).toContain('doNotSay');
  });

  it('respects rule toggles — disabling noEmDash drops em-dash violations', () => {
    const text = 'a—b';
    const r = checkExclusions(
      text,
      settings({ structuralRules: { noStaccato: true, noEmDash: false, noSmartQuotes: true } }),
    );
    expect(r.violations).toEqual([]);
  });

  it('respects rule toggles — empty doNotSay list is silent', () => {
    const r = checkExclusions('delve here', settings({ doNotSay: [] }));
    expect(r.violations).toEqual([]);
  });

  it('returns violations sorted by start offset', () => {
    const text = `“hi” delve — ok`;
    const r = checkExclusions(text, settings({ doNotSay: ['delve'] }));
    const offsets = r.violations.map((v) => v.start);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});
