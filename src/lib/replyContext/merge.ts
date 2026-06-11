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
 *  (timeline vs modal) compare equal. Exported because the overlay's
 *  text-identity article search (extract.ts) must normalize the SAME
 *  way — a second definition drifting from this one is the bug class
 *  conventions.md rule 4 exists to prevent. */
export function normalizeTweetText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * True when `partial` reads as a truncated rendering of `full` — the
 * visible prefix X shows before a "Show more" link, any trailing
 * ellipsis removed, both sides whitespace-normalized. Used by the
 * overlay's article finder so a lock captured from the EXPANDED tweet
 * still recognizes a re-truncated copy (X's modal renders long tweets
 * collapsed again). Callers must separately confirm the candidate is
 * actually truncated — a plain short tweet must never prefix-match.
 */
export function isTruncatedRenderingOf(full: string, partial: string): boolean {
  const fullNorm = normalizeTweetText(full);
  // X nests the literal "Show more" label inside the tweet-text node on
  // some renderings, so the visible text reads "…prefix… Show more" —
  // strip the label, then any trailing ellipsis. (The label string is
  // the same X-markup assumption isTweetTruncated already encodes.)
  const partialNorm = normalizeTweetText(partial)
    .replace(/(?:…|\.{3})?\s*Show more$/i, '')
    .replace(/(?:…|\.{3})$/, '')
    .trimEnd();
  if (partialNorm === '') return false;
  return fullNorm.length > partialNorm.length && fullNorm.startsWith(partialNorm);
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
