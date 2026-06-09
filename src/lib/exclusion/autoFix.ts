/**
 * Mechanical auto-fixer for the safely-fixable structural rules.
 *
 * Two fixes are applied (each gated by the matching setting toggle):
 *   - Em dash → comma. We consume surrounding whitespace so
 *     "I went — you stayed" becomes "I went, you stayed" rather than
 *     "I went , you stayed".
 *   - Smart/curly quotes → straight quotes. One-to-one substitution.
 *
 * Staccato and do-not-say are detection-only — removing them
 * mechanically would break sentences. They flow into the repair
 * re-prompt instead.
 *
 * Returns the fixed text plus the spans (in the ORIGINAL text) of
 * everything that was rewritten, so callers can record what changed.
 */
import type { Span } from './types';

export interface AutoFixOptions {
  fixEmDash: boolean;
  fixSmartQuotes: boolean;
}

interface PendingFix {
  start: number;
  end: number;
  replaceWith: string;
  rule: Span['rule'];
}

const SMART_TO_STRAIGHT: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
};

export function autoFix(
  text: string,
  options: AutoFixOptions,
): { text: string; appliedFixes: Span[] } {
  const fixes: PendingFix[] = [];

  if (options.fixEmDash) {
    const re = /\s*—\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      fixes.push({
        start: m.index,
        end: m.index + m[0].length,
        replaceWith: ', ',
        rule: 'emDash',
      });
    }
  }

  if (options.fixSmartQuotes) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch && ch in SMART_TO_STRAIGHT) {
        // Skip if this index falls inside an already-recorded em-dash
        // fix (defensive — em-dash regions don't contain smart quotes
        // in practice but keep the invariant).
        if (fixes.some((f) => i >= f.start && i < f.end)) continue;
        fixes.push({
          start: i,
          end: i + 1,
          replaceWith: SMART_TO_STRAIGHT[ch] ?? ch,
          rule: 'smartQuote',
        });
      }
    }
  }

  fixes.sort((a, b) => a.start - b.start);

  let output = '';
  let cursor = 0;
  const applied: Span[] = [];
  for (const f of fixes) {
    if (f.start < cursor) continue;
    output += text.slice(cursor, f.start);
    output += f.replaceWith;
    applied.push({
      start: f.start,
      end: f.end,
      rule: f.rule,
      matchedText: text.slice(f.start, f.end),
    });
    cursor = f.end;
  }
  output += text.slice(cursor);

  return { text: output, appliedFixes: applied };
}
