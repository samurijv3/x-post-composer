/**
 * Decide whether a captured tweet is a standalone post or a reply.
 *
 * The content script gathers signals from the DOM and hands them to
 * this function. The classification is a best guess — the Voice tab
 * lets the user override per item.
 *
 * Signal precedence (most reliable first):
 *   1. `hasReplyContextNode` — X renders a "Replying to @..." marker
 *      inside the article on FEED views (home, with_replies, etc.).
 *   2. `inReplyToStatusId` — when X exposes a parent status id.
 *   3. `isPrecededByParentArticle` — true only when the content script
 *      has already established "we're on a `/handle/status/id` detail
 *      page AND this article is rendered below another tweet article."
 *      On status detail pages X omits the textual "Replying to" line
 *      because the parent tweet is visually present above the reply.
 *   4. Otherwise → 'post'.
 *
 * Self-threads (you replying to yourself) count as 'reply'. The user
 * can override in the Voice tab if they want to treat thread heads as
 * posts.
 */
export interface TweetContext {
  /** True when the article contains an X "Replying to @x" marker. */
  hasReplyContextNode: boolean;
  /** The parent status id when visible in the DOM. Null when absent. */
  inReplyToStatusId: string | null;
  /** Set by the content script ONLY on `/handle/status/id` detail
   *  pages, where vertical order genuinely encodes the conversation
   *  (everything below the focal tweet is a reply). Always false on
   *  feeds: profile/home streams render unrelated tweets in adjacent
   *  non-empty cells, so position means nothing there (field-falsified
   *  2026-06-12) — on feeds, signal 1 is the only reply signal. */
  isPrecededByParentArticle: boolean;
}

export function classifyType(context: TweetContext): 'post' | 'reply' {
  if (context.hasReplyContextNode) return 'reply';
  if (context.inReplyToStatusId !== null && context.inReplyToStatusId !== '') return 'reply';
  if (context.isPrecededByParentArticle) return 'reply';
  return 'post';
}
