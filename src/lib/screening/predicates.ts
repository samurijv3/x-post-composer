/**
 * Cheap, deterministic quality predicates.
 *
 * In v1 these only power a soft "low-quality?" hint on the Voice tab —
 * the user can always ignore them and keep an item. Phase 2's bulk
 * import will use them to filter the firehose. Either way the predicates
 * themselves must be load-bearing today, so they have full test coverage.
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
 * `min` is measured in JavaScript code units (consistent with what users
 * see in the Voice tab); twitter-text-aware counting lives in Chunk 3.
 */
export function isBelowMinChars(text: string, min: number): boolean {
  return text.trim().length < min;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const FLAG_INDICATOR = /\p{Regional_Indicator}/u;
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u;
