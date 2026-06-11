/**
 * A single piece of writing captured for voice sampling.
 *
 * `embedding` is reserved for semantic retrieval (deferred — CLAUDE.md §8)
 * and MUST exist on every record. In v1 the field is always `null`; later
 * a background job can fill it in without a schema migration.
 */
export interface LibraryItem {
  /** Stable identifier. Use the tweet id when available, otherwise a uuid. */
  id: string;
  /** The exact text of the post or reply. */
  text: string;
  /** Whether this item is a standalone post or a reply to another tweet. */
  type: 'post' | 'reply';
  /** How the item entered the library (roadmap Core Concept A —
   *  system-assigned, mutually exclusive):
   *   - 'manual'  — handpicked by the user: one-click capture on x.com
   *                 OR pasted into the Add Manually form. Both are
   *                 individual acts of attention; the old 'capture'
   *                 source collapsed into this (DB v3).
   *   - 'shipped' — composed in the tool and copied out to X (the
   *                 Phase 4 corpus loop). Self-curating.
   *   - 'archive' — bulk-imported from an X archive export (Phase 7;
   *                 renamed from 'import' in DB v3). Breadth, not
   *                 curation.
   */
  source: 'manual' | 'shipped' | 'archive';
  /** Author handle without the leading `@`. */
  authorHandle: string;
  /** Author display name as rendered by X (e.g. "Sam Altman"). Best-effort —
   *  null on items captured before this field existed, or when X's markup
   *  hides the name. */
  authorDisplayName: string | null;
  /** Full URL to the author's avatar on `pbs.twimg.com`. Best-effort —
   *  null on items captured before this field existed or when the avatar
   *  cannot be located. See CLAUDE.md §6 for the inbound-image carve-out. */
  authorAvatarUrl: string | null;
  /** ISO 8601 string for when the tweet itself was published. */
  timestamp: string;
  /** Engagement counts from X, when available. `null` when unknown. */
  engagement: { likes?: number; reposts?: number } | null;
  /** Reserved for semantic retrieval; always null in v1. */
  embedding: number[] | null;
  /** Epoch ms at the moment the item was stored. */
  createdAt: number;
}
