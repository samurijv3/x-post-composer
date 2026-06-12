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
  /** The exact text of the post or reply. For threads, the joined
   *  segments (`joinSegments`) — so search, dedupe, and previews see
   *  the whole thread as one body. */
  text: string;
  /** What this item is: a standalone post, a reply to another tweet,
   *  or a THREAD — a post plus successive self-replies, stored as one
   *  atomic item (roadmap Phase 10; deliberately NOT metadata over
   *  constituent post/reply rows, which would pollute reply sampling
   *  and create hole semantics). */
  type: 'post' | 'reply' | 'thread';
  /** Thread segments in order, each carrying its own tweet identity
   *  when known (capture has status ids; composed/pasted threads
   *  don't). Null on posts/replies. Segment ids keep capture-dedupe
   *  honest ("this tweet is segment 3 of a saved thread") and let the
   *  future archive import reconstruct chains. */
  segments: { text: string; statusId: string | null }[] | null;
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
  /** Star (Core Concept A): the user's judgment laid on top of source —
   *  orthogonal to it. Starred items form their own guaranteed sampling
   *  pool and feed <aspirational_examples>. Starrable on 'manual' and
   *  'shipped' only (the archive is the stream you haven't individually
   *  engaged with — promote via X-search + handpick instead). */
  favorite: boolean;

  /** Reserved for semantic retrieval; always null in v1. */
  embedding: number[] | null;
  /** Epoch ms at the moment the item was stored. */
  createdAt: number;
}
