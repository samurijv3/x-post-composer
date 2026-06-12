/**
 * The draft-commit EVENT — the corpus half of "done".
 *
 * Roadmap Core Concept C separates two facts that copy-to-X signals at
 * once: "I'm done with this draft in the tool" (the lifecycle state,
 * lib/draft/lifecycle.ts) and "this text became a published tweet" (a
 * corpus event, this hook). Conflating them is what would let the
 * corpus fill with not-quite-final text.
 *
 * v1 wiring: NOTHING listens. Phase 4 (the shipped-tweet corpus loop)
 * subscribes here to save committed drafts as `source: shipped` voice
 * examples. The hook exists now so that loop bolts on without touching
 * the commit path.
 */

export interface DraftCommit {
  /** The committed text, hand edits included. For threads this is the
   *  segments JOINED in the canonical wire format (lib/thread). */
  text: string;
  /** Thread segments in order; null for single posts/replies. */
  segments: string[] | null;
  mode: 'post' | 'reply' | 'thread';
  /** Whether the user hand-edited the model's output before shipping. */
  handEdited: boolean;
  /** The bundle that seeded this draft (lifecycle `seedBundleId`), or
   *  null. When the shipped save persists, the new corpus item
   *  auto-files into this bundle — the bundle is a living template. */
  seedBundleId: string | null;
  /** Epoch ms, supplied by the caller (this module stays time-free). */
  committedAt: number;
}

type CommitListener = (commit: DraftCommit) => void;
type Unsubscribe = () => void;

const listeners = new Set<CommitListener>();

/** Subscribe to future commits. Returns an unsubscribe. */
export function onDraftCommit(listener: CommitListener): Unsubscribe {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce a commit to every subscriber. A listener that throws does
 *  not silence the others — commit announcement is best-effort. */
export function emitDraftCommit(commit: DraftCommit): void {
  for (const listener of [...listeners]) {
    try {
      listener(commit);
    } catch {
      // A misbehaving listener must not break the commit path or
      // starve its siblings. Nothing to surface: the user's copy
      // already succeeded; this event is downstream bookkeeping.
    }
  }
}
