/**
 * The HARD filter that decides whether a captured tweet may enter the
 * library. Nothing whose author handle does not exactly match the
 * configured handle is allowed in — that also screens out reposts of
 * other people's tweets and any quote-tweet author drift.
 *
 * Comparison rules:
 *   - Case-insensitive (X handles are case-preserved but case-insensitive).
 *   - Leading `@` is ignored on either side.
 *   - Surrounding whitespace is ignored.
 *   - Empty handles never match (an unset configured handle must reject
 *     every capture).
 */
export function validateAuthor(tweetHandle: string, configuredHandle: string): boolean {
  const a = normalize(tweetHandle);
  const b = normalize(configuredHandle);
  if (a === '' || b === '') return false;
  return a === b;
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}
