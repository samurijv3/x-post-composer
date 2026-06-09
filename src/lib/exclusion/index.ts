export {
  detectEmDash,
  detectSmartQuotes,
  detectStaccato,
} from './structural';
export { detectDoNotSay } from './doNotSay';
export { autoFix, type AutoFixOptions } from './autoFix';
export { checkExclusions, hasRepairableViolations, type ExclusionCheckResult } from './check';
export type { Span, RuleId } from './types';
