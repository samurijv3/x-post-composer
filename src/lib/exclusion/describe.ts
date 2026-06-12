/**
 * Human-facing summary of violation spans — what the compose UI's
 * violation note renders next to the highlights. Deliberately a
 * SIBLING of the model-facing `summarizeViolations` (lib/prompt), not
 * shared: prompt copy and UI copy drift for different reasons.
 */
import type { RuleId, Span } from './types';

/** Singular/plural label per structural rule. */
const RULE_LABELS: Record<Exclude<RuleId, 'doNotSay'>, { one: string; many: string }> = {
  emDash: { one: 'an em dash', many: 'em dashes' },
  smartQuote: { one: 'a curly quote', many: 'curly quotes' },
  staccato: { one: 'a staccato run (3+ short sentences)', many: 'staccato runs' },
  aiColon: { one: 'a label-colon opener', many: 'label-colon openers' },
};

const RULE_ORDER: Exclude<RuleId, 'doNotSay'>[] = ['emDash', 'smartQuote', 'staccato', 'aiColon'];

/**
 * Describe violation spans for the user: counted structural rules in a
 * fixed order, then banned words quoted by their banlist entry —
 * `"2 em dashes · a curly quote · banned word “leverage”"`. Empty
 * input returns '' (the caller hides the note).
 */
export function describeViolations(violations: Span[]): string {
  const parts: string[] = [];
  for (const rule of RULE_ORDER) {
    const count = violations.filter((v) => v.rule === rule).length;
    if (count === 0) continue;
    const label = RULE_LABELS[rule];
    parts.push(count === 1 ? label.one : `${String(count)} ${label.many}`);
  }
  // Banned words: one mention per distinct entry, however many hits.
  const banned = [
    ...new Set(
      violations
        .filter((v) => v.rule === 'doNotSay')
        .map((v) => (v.entry ?? v.matchedText).toLowerCase()),
    ),
  ];
  if (banned.length === 1) {
    parts.push(`banned word “${banned[0] ?? ''}”`);
  } else if (banned.length > 1) {
    parts.push(`banned words ${banned.map((w) => `“${w}”`).join(', ')}`);
  }
  return parts.join(' · ');
}
