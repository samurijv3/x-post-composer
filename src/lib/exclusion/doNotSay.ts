/**
 * Whole-word matcher for the do-not-say banlist.
 *
 * Rules (deliberately simple — see CLAUDE.md ethos):
 *   - Case-insensitive.
 *   - "Whole word" means matches must align with token boundaries:
 *     letters/numbers/apostrophes form a token, anything else is a
 *     delimiter. So "art" does NOT match "start"; "fine art" matches
 *     the two-word sequence; "fine art" does NOT match "modern art".
 *   - No regex syntax. No stemming. No plural collapsing. Entries match
 *     verbatim (modulo case + delimiter normalisation).
 *   - An entry that tokenises to nothing (empty string, punctuation
 *     only) is silently skipped — never matches the whole text.
 */
import type { Span } from './types';

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Tokenise a string into word atoms. Apostrophes (don't, it's) keep
 *  the token intact; everything else is a delimiter. Unicode letters
 *  and numbers are recognised so non-ASCII words tokenise normally. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}'_]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

export function detectDoNotSay(text: string, entries: string[]): Span[] {
  const textTokens = tokenize(text);
  const spans: Span[] = [];
  for (const rawEntry of entries) {
    const entryTokens = tokenize(rawEntry).map((t) => t.text.toLowerCase());
    if (entryTokens.length === 0) continue;
    const last = entryTokens.length - 1;
    for (let i = 0; i + entryTokens.length <= textTokens.length; i++) {
      let isMatch = true;
      for (let j = 0; j < entryTokens.length; j++) {
        const txt = textTokens[i + j];
        if (!txt || txt.text.toLowerCase() !== entryTokens[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        const first = textTokens[i];
        const lastTok = textTokens[i + last];
        if (first && lastTok) {
          spans.push({
            start: first.start,
            end: lastTok.end,
            rule: 'doNotSay',
            matchedText: text.slice(first.start, lastTok.end),
            entry: rawEntry,
          });
        }
      }
    }
  }
  return spans;
}
