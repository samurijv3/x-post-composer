/**
 * Library dedupe (roadmap Core Concept A): the same tweet must never be
 * counted twice, or the voice silently skews toward whatever got
 * double-counted.
 *
 * Identity: tweet id when both sides carry one (a captured item's
 * record id IS its status id), normalized text otherwise — the SAME
 * normalizer the reply-context same-tweet merge uses, so "the same
 * tweet" means one thing everywhere (conventions rule 4).
 *
 * Resolution: source precedence `manual > shipped > archive`. An
 * equal-or-higher-precedence write updates the existing record in
 * place (a handpick of a shipped/archive item promotes it to
 * 'manual'); a lower-precedence write never downgrades — it changes
 * nothing and inserts nothing. The record's storage id is stable
 * through updates: identity-of-tweet decides the match, the primary
 * key never moves.
 */
import type { LibraryItem } from '../../types';
import { normalizeTweetText } from '../replyContext';

export const SOURCE_PRECEDENCE: Record<LibraryItem['source'], number> = {
  manual: 3,
  shipped: 2,
  archive: 1,
};

/**
 * Find the existing record for a not-yet-stored candidate, by tweet id
 * first (when the candidate has one), then by normalized text. The
 * text fallback is what recognizes a shipped draft (uuid record) when
 * the published tweet is later handpicked (status id in hand).
 */
export function findLibraryDuplicate(
  items: LibraryItem[],
  candidate: { statusId: string | null; text: string },
): LibraryItem | null {
  if (candidate.statusId !== null) {
    const byId = items.find((i) => i.id === candidate.statusId);
    if (byId) return byId;
  }
  const wanted = normalizeTweetText(candidate.text);
  if (wanted === '') return null;
  return items.find((i) => normalizeTweetText(i.text) === wanted) ?? null;
}

/**
 * Resolve a duplicate. Returns the EXISTING object untouched when the
 * incoming source ranks lower (callers can use identity to skip the
 * write); otherwise returns the updated record: incoming source/type/
 * text win (the fresh read is authoritative), display metadata
 * enriches rather than erases, and id/createdAt/embedding stay with
 * the existing record.
 */
export function mergeLibraryDuplicate(existing: LibraryItem, incoming: LibraryItem): LibraryItem {
  if (SOURCE_PRECEDENCE[incoming.source] < SOURCE_PRECEDENCE[existing.source]) {
    return existing;
  }
  return {
    ...existing,
    source: incoming.source,
    type: incoming.type,
    text: incoming.text,
    authorDisplayName: incoming.authorDisplayName ?? existing.authorDisplayName,
    authorAvatarUrl: incoming.authorAvatarUrl ?? existing.authorAvatarUrl,
    timestamp: incoming.timestamp,
    engagement: incoming.engagement ?? existing.engagement,
  };
}
