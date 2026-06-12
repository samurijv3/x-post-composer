/**
 * Thread segment text — the ONE place the segment wire format lives
 * (conventions rule 4). A thread travels as one string with segments
 * separated by a line containing only `---`: that is what the model is
 * instructed to emit, what the refine template's {{draft}} carries,
 * what LibraryItem.text stores (joined), and what the paste-a-thread
 * form accepts. parse/join are inverses: parse(join(x)) === x for any
 * list of trimmed, non-empty, delimiter-free segments.
 */

/** The separator line between segments — alone on its own line. */
export const THREAD_DELIMITER = '---';

/** Canonical joiner ('\n---\n'). */
const JOINER = `\n${THREAD_DELIMITER}\n`;

/** Default ≈N target for thread composition. A code constant, not a
 *  settings field — the target is per-composition (the stepper), and a
 *  field nothing reads across sessions would be dead config. */
export const DEFAULT_THREAD_TARGET = 5;

/**
 * Split a delimiter-formatted thread into ordered segments. Tolerant
 * of what models actually emit: delimiter lines may carry surrounding
 * whitespace; blank segments drop; an accidental leading "1/", "2.",
 * "3)" numbering on a segment is stripped (narrow — digits followed by
 * one of / . ) and whitespace, at the very start only, so legitimate
 * openings like "2024 was the year…" survive). A string with no
 * delimiter returns one segment (the model ignored the format — the
 * pipeline's count validation catches and re-instructs).
 */
export function parseThreadSegments(raw: string): string[] {
  // Multiline line-anchor split: a delimiter is a LINE of 3+ dashes
  // (optional surrounding spaces). Anchors don't consume the adjacent
  // newlines, so back-to-back delimiters can't swallow each other.
  return raw
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((segment) => segment.trim())
    .map(stripLeadingNumbering)
    .filter((segment) => segment !== '');
}

/** Join segments into the canonical wire format. */
export function joinSegments(segments: string[]): string {
  return segments.join(JOINER);
}

function stripLeadingNumbering(segment: string): string {
  return segment.replace(/^\s*\d{1,2}[/.)]\s+/, '');
}
