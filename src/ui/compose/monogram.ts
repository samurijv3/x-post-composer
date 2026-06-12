/** One-letter monogram for the user's avatar disc (no avatar URL —
 *  the panel only knows the configured handle). */
export function monogram(handle: string): string {
  const ch = handle.replace(/^@/, '').charAt(0);
  return ch === '' ? '·' : ch.toUpperCase();
}
