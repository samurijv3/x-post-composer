/**
 * Bullet handling for the prompt box — detected from how the user
 * already types, never a mode toggle. A line opened with `- ` or `* `
 * converts to a real `•` as it's typed (the shell intercepts the
 * space keystroke; `normalizeTypedBullets` is the paste-time safety
 * net), Enter continues the list, and the presence of any bullet line
 * is the explicit "fragments" signal for the intent framing
 * (`GenerationRequest.bulletedInput`).
 */

export const BULLET_PREFIX = '• ';

/** Convert typed `- ` / `* ` line openers to the real glyph. Length-
 *  preserving (one char swaps for one char) so caret positions survive
 *  the controlled-input round trip. */
export function normalizeTypedBullets(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)[-*](\s)/, '$1•$2'))
    .join('\n');
}

/** True when any line is a bullet — the fragments signal. */
export function hasBulletLines(text: string): boolean {
  return /(^|\n)\s*•/.test(text);
}

/** Remove leading bullet glyphs from every line (display contexts —
 *  e.g. the collapsed brief shows the first line without its glyph). */
export function stripBulletPrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)•\s*/, '$1'))
    .join('\n');
}
