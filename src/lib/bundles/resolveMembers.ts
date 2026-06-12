/**
 * Pure bundle logic: resolving member references against the library
 * and growing membership. Bundles store ids, never copies — these
 * helpers are where dangling references (deleted library items) get
 * tolerated honestly: dropped from resolution, surfaced as a count.
 */
import type { Bundle, LibraryItem } from '../../types';

export interface ResolvedBundleMembers {
  /** The members that still exist, in the bundle's stored order. A
   *  duplicated id (defensive — membership writes guard against it)
   *  resolves once, at its first position. */
  members: LibraryItem[];
  /** How many stored ids no longer resolve — shown to the user, never
   *  silently absorbed ("3 members · 1 missing"). */
  missingCount: number;
}

/** Resolve a bundle's member ids against the current library. */
export function resolveBundleMembers(
  memberIds: string[],
  library: LibraryItem[],
): ResolvedBundleMembers {
  const byId = new Map(library.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const members: LibraryItem[] = [];
  let missingCount = 0;
  for (const id of memberIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (item) members.push(item);
    else missingCount++;
  }
  return { members, missingCount };
}

/**
 * Membership grows by appending — auto-filing a shipped draft adds it
 * at the end of the series. Returns the existing bundle BY IDENTITY
 * when the id is already a member, so callers can skip the write
 * (same convention as `mergeLibraryDuplicate`).
 */
export function appendBundleMember(bundle: Bundle, itemId: string): Bundle {
  if (bundle.memberIds.includes(itemId)) return bundle;
  return { ...bundle, memberIds: [...bundle.memberIds, itemId] };
}

/**
 * Move a member one VISIBLE step up or down. The swap partner is the
 * nearest neighbor that still resolves (`presentIds`), so a dangling
 * id between two live members never swallows the move — dangling ids
 * keep their own slots (they may be restored by a delete-undo).
 * Returns the bundle BY IDENTITY when no move is possible (unknown id,
 * or already at that end of the visible list).
 */
export function moveBundleMember(
  bundle: Bundle,
  itemId: string,
  direction: 'up' | 'down',
  presentIds: ReadonlySet<string>,
): Bundle {
  const ids = bundle.memberIds;
  const from = ids.indexOf(itemId);
  if (from === -1) return bundle;
  const step = direction === 'up' ? -1 : 1;
  for (let to = from + step; to >= 0 && to < ids.length; to += step) {
    const neighbor = ids[to];
    if (neighbor !== undefined && presentIds.has(neighbor)) {
      const next = [...ids];
      next[from] = neighbor;
      next[to] = itemId;
      return { ...bundle, memberIds: next };
    }
  }
  return bundle;
}
