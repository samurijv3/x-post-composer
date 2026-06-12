/**
 * The library search predicate (Voice screen). Token-AND substring
 * matching: every whitespace-separated token in the query must appear
 * somewhere in the text, case-insensitively — "validation trap"
 * matches a tweet containing both words anywhere, in any order. An
 * empty or whitespace-only query matches everything (search off).
 *
 * Deliberately this simple: no fuzziness, no ranking, no stemming —
 * the list whittles as you type and the user can see exactly why a
 * row matched. Legibility over cleverness, same as the bundles bet.
 */
export function matchesSearch(text: string, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '');
  if (tokens.length === 0) return true;
  const haystack = text.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}
