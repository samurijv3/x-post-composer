/**
 * One offending region in a draft.
 *
 * `start`/`end` are JS code-unit offsets into the original draft text so
 * the UI can highlight the span verbatim. `rule` lets the UI colour by
 * detector. `entry` is only populated for `doNotSay` hits and records
 * which banned word/phrase matched, so the repair prompt can name it.
 */
export type RuleId = 'emDash' | 'smartQuote' | 'staccato' | 'aiColon' | 'doNotSay';

export interface Span {
  start: number;
  end: number;
  rule: RuleId;
  matchedText: string;
  /** Populated only when `rule === 'doNotSay'`. */
  entry?: string;
}
