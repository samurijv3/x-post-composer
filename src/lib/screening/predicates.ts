/**
 * Cheap, deterministic quality predicates.
 *
 * DORMANT IN v1 — nothing imports this module yet. It exists (tested)
 * for Phase 2's bulk archive import, which will use these to filter
 * the firehose; the seam is documented in CLAUDE.md §3. Keeping the
 * predicates load-bearing now means import bolts on without writing
 * fresh untested filters later.
 *
 * Every predicate trims its input before measuring. None mutate input.
 */

/**
 * True when the trimmed text contains at least one pictographic and no
 * other visible character. Accepts:
 *   - Pictographic emoji (👋, 🍕, …)
 *   - Regional-indicator flags (🇺🇸)
 *   - Skin-tone modifiers (👋🏽)
 *   - ZWJ sequences (👨‍👩‍👧) and variation selectors
 *   - Whitespace
 *
 * Empty / whitespace-only strings return false (they have no emoji).
 *
 * Implementation note: we iterate by code point and classify each
 * one. A single negated character class containing both ZWJ (U+200D)
 * and VS16 (U+FE0F) would trip ESLint's `no-misleading-character-class`
 * because adjacent combining marks in a class can render differently
 * than expected; iterating sidesteps that without disabling the rule.
 */
export function isEmojiOnly(text: string): boolean {
  let sawPictographic = false;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (PICTOGRAPHIC.test(ch)) {
      sawPictographic = true;
      continue;
    }
    if (FLAG_INDICATOR.test(ch)) {
      sawPictographic = true;
      continue;
    }
    if (EMOJI_MODIFIER.test(ch)) continue;
    if (ch === '‍' || ch === '️') continue;
    return false;
  }
  return sawPictographic;
}

/**
 * True when the trimmed text contains exactly one whitespace-delimited
 * token. Empty / whitespace-only input returns false.
 */
export function isSingleWord(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  return !/\s/.test(trimmed);
}

/**
 * True when the trimmed text is shorter than `min` characters.
 * `min` is measured in plain JavaScript code units — a quality screen
 * doesn't need X's weighted counting (that lives in lib/counting).
 */
export function isBelowMinChars(text: string, min: number): boolean {
  return text.trim().length < min;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const FLAG_INDICATOR = /\p{Regional_Indicator}/u;
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u;
