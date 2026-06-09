/**
 * Minimal ambient declaration for `twitter-text`. The library is
 * untyped upstream; we only use `parseTweet` and care about
 * `weightedLength`. Everything else is opaque.
 */
declare module 'twitter-text' {
  export interface ParseTweetResult {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    validRangeStart: number;
    validRangeEnd: number;
    displayRangeStart: number;
    displayRangeEnd: number;
  }
  export function parseTweet(text: string): ParseTweetResult;
  const _default: { parseTweet: typeof parseTweet };
  export default _default;
}
