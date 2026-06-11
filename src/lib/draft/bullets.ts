/**
 * Bullet-mode text transforms for the prompt box — real `•` bullets,
 * not typed asterisks. Pure string functions; the panel applies them
 * when the user toggles bullet mode (the per-keystroke Enter behavior
 * is a one-line `setRangeText` in the shell). A bulleted input is also
 * an explicit "fragments" signal for the intent framing — see
 * `GenerationRequest.bulletedInput`.
 */

export const BULLET_PREFIX = '• ';

/** Prefix every non-empty line that doesn't already carry a bullet.
 *  Existing `-` / `*` markers are upgraded to the real glyph. */
export function applyBulletPrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('•')) return line;
      const upgraded = trimmed.replace(/^[-*]\s*/, '');
      return BULLET_PREFIX + upgraded;
    })
    .join('\n');
}

/** Remove leading bullet glyphs from every line (toggle OFF). */
export function stripBulletPrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)•\s*/, '$1'))
    .join('\n');
}
