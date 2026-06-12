/**
 * A context bundle (roadmap Phase 6): a named, ordered set of library
 * items the user picked as the PRIMARY voice seed for a composition —
 * user-controlled manual retrieval, the transparent alternative to
 * semantic retrieval. The canonical case is a series ("day X") whose
 * new entry should read like its siblings, not like the user's average
 * tweet.
 *
 * Members are referenced by `LibraryItem.id`, never copied. A member
 * deleted from the library leaves a dangling id behind ON PURPOSE:
 * the library's delete has an undo that restores the same id, so eager
 * cleanup would break it. Dangling ids drop out at resolution time
 * (`lib/bundles` `resolveBundleMembers`) and the UI surfaces an honest
 * member count instead.
 */
export interface Bundle {
  /** Stable uuid (bundles never have a tweet identity of their own). */
  id: string;
  /** User-given name, shown wherever the bundle drives examples. */
  name: string;
  /** Ordered library-item ids: selection order at creation; shipped
   *  drafts seeded by this bundle append at the end (auto-filing). */
  memberIds: string[];
  /** Epoch ms at the moment the bundle was created. */
  createdAt: number;
}
