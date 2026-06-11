/**
 * Top-level exclusion check. Combines the structural detectors and the
 * do-not-say matcher, gated by the user's settings. Returns every
 * remaining violation in the text — what survives an `autoFix` pass.
 *
 * Used by the generation orchestrator to decide whether to fire the
 * single repair re-prompt, and by the UI to highlight residue.
 */
import type { Settings } from '../../types';
import { detectAiColon, detectEmDash, detectSmartQuotes, detectStaccato } from './structural';
import { detectDoNotSay } from './doNotSay';
import type { Span } from './types';

export interface ExclusionCheckResult {
  /** Every offending span across all enabled rules, sorted by start. */
  violations: Span[];
}

export function checkExclusions(text: string, settings: Settings): ExclusionCheckResult {
  const violations: Span[] = [];
  if (settings.structuralRules.noEmDash) violations.push(...detectEmDash(text));
  if (settings.structuralRules.noSmartQuotes) violations.push(...detectSmartQuotes(text));
  if (settings.structuralRules.noStaccato) violations.push(...detectStaccato(text));
  if (settings.structuralRules.noAiColon) violations.push(...detectAiColon(text));
  if (settings.doNotSay.length > 0) {
    violations.push(...detectDoNotSay(text, settings.doNotSay));
  }
  violations.sort((a, b) => a.start - b.start);
  return { violations };
}

/** True when the result contains anything the repair pass should target. */
export function hasRepairableViolations(result: ExclusionCheckResult): boolean {
  return result.violations.length > 0;
}
