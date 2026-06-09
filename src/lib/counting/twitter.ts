/**
 * Canonical character counting for X.
 *
 * Wraps `twitter-text` so the rest of the codebase doesn't import the
 * library directly. The library has no bundled .d.ts; we declare just
 * the narrow surface we actually call.
 *
 * Why we cannot use `.length`: X's count is *weighted*. URLs always
 * count as 23 regardless of their literal length, and characters from
 * many CJK / Korean / Hindi blocks count as 2. Naive `String.length`
 * undercounts URL-bearing tweets and overcounts non-Latin scripts —
 * either way it disagrees with what X shows the user.
 *
 * We expose three things:
 *   - `weightedLength(text)` — the official count.
 *   - `isOver280(text)`     — the deterministic ≤280 gate.
 *   - `isOverSoftCap(text, n)` — uncapped guardrail (raw `.length`,
 *     intentionally — the soft cap is our own thing, not X's, and X
 *     weighting would be misleading here).
 */

interface TwitterTextLike {
  parseTweet: (text: string) => { weightedLength: number };
}

// `twitter-text` ships untyped and has a quirky CJS / ESM dual shape:
// CJS exposes `parseTweet` on the root, ESM tucks it behind `.default`.
// Vite (Rolldown) bundles the import as a namespace, so a plain
// `import x from 'twitter-text'` resolved to the namespace at run time
// in our build and `x.parseTweet` was undefined. Importing the default
// explicitly (and falling back to the namespace when a CJS-style host
// returns the object directly) keeps both environments happy.
import twitterTextDefault from 'twitter-text';
import * as twitterTextNS from 'twitter-text';

const twitterText: TwitterTextLike = (() => {
  const fromDefault = twitterTextDefault as unknown as Partial<TwitterTextLike>;
  if (typeof fromDefault.parseTweet === 'function') return fromDefault as TwitterTextLike;
  const nsAny = twitterTextNS as unknown as {
    parseTweet?: TwitterTextLike['parseTweet'];
    default?: TwitterTextLike;
  };
  if (typeof nsAny.parseTweet === 'function') return nsAny as TwitterTextLike;
  if (nsAny.default && typeof nsAny.default.parseTweet === 'function') return nsAny.default;
  throw new Error('twitter-text loaded but parseTweet is missing — module shape changed.');
})();

export const X_HARD_LIMIT = 280;

export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

export function isOver280(text: string): boolean {
  return weightedLength(text) > X_HARD_LIMIT;
}

export function isOverSoftCap(text: string, softCapChars: number): boolean {
  return text.length > softCapChars;
}
