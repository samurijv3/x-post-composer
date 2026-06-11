/**
 * Same-tweet merge for reply-context selections.
 *
 * X renders the same tweet with different fidelity in different places:
 * the timeline copy carries author links and a /status/ timestamp link;
 * the copy inside the reply modal / lightbox is not clickable and so
 * carries neither. Selecting that modal copy used to REPLACE a rich
 * lock with a degraded one (no status id → no highlight, no handle →
 * nameless panel card). This merge recognizes "same tweet, different
 * delivery" and keeps the richest value per field instead.
 */
import type { ReplyContext } from '../../types';

/** Collapse whitespace runs so two renderings of the same tweet text
 *  (timeline vs modal) compare equal. */
function normalizeTweetText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Status ids decide when both sides have one; otherwise fall back to
 *  normalized text (the corpus dedupe rule, Core Concept A). */
function isSameTweet(a: ReplyContext, b: ReplyContext): boolean {
  if (a.targetStatusId !== null && b.targetStatusId !== null) {
    return a.targetStatusId === b.targetStatusId;
  }
  return normalizeTweetText(a.targetText) === normalizeTweetText(b.targetText);
}

/**
 * Fold a fresh selection into the existing lock. A different tweet (or
 * no existing lock) returns the incoming selection unchanged — a normal
 * swap. The same tweet merges field-wise: the fresh reading wins where
 * it has a value, the existing lock fills what the fresh delivery
 * couldn't see, and media-unreadability sticks if either reading hit it.
 */
export function mergeReplyContextSelection(
  existing: ReplyContext | null,
  incoming: ReplyContext,
): ReplyContext {
  if (existing === null || !isSameTweet(existing, incoming)) return incoming;
  return {
    targetText: incoming.targetText,
    targetAuthorHandle: incoming.targetAuthorHandle ?? existing.targetAuthorHandle,
    targetAuthorDisplayName: incoming.targetAuthorDisplayName ?? existing.targetAuthorDisplayName,
    targetAuthorAvatarUrl: incoming.targetAuthorAvatarUrl ?? existing.targetAuthorAvatarUrl,
    targetTimestamp: incoming.targetTimestamp ?? existing.targetTimestamp,
    targetStatusId: incoming.targetStatusId ?? existing.targetStatusId,
    grandparentText: incoming.grandparentText ?? existing.grandparentText,
    hadUnreadableMedia: incoming.hadUnreadableMedia || existing.hadUnreadableMedia,
  };
}
