/**
 * The draft lifecycle state machine (roadmap Core Concept C):
 *
 *   empty → generating → active (editable, refinable) → committed
 *
 * Pure reducer — the panel composes it (CLAUDE.md §3 applies to state
 * machines too). Everything consequential about the draft's life is
 * decided here and tested: stale-generation gating, the two coexisting
 * undo scopes, hand-edit semantics, and what commit resolves.
 *
 * MULTI-POST (roadmap Phase 10): a draft is `posts[]` — length 1 for
 * single posts/replies, N for threads. Each post carries its own text,
 * violation spans (offsets into THAT post), and a `copied` flag. The
 * ONE commit rule: a draft is committed when EVERY post has been
 * copied since its text last changed — single mode is just the N=1
 * case (its one Copy commits immediately). Editing a post resets that
 * post's `copied` flag and re-opens the draft.
 *
 * The two undo scopes (deliberately separate):
 *   - `replaced` — the TIMED undo (~5 s, Gmail-undo-send convention).
 *     Guards draft REPLACEMENT: a generate/regenerate landing over an
 *     existing draft, or a new reply context clearing it. The shell owns
 *     the timer and dispatches `replacement-expired`; touching the new
 *     draft (hand edit / refine) adopts it and drops the snapshot.
 *   - `refineSnapshot` — the ONE-LEVEL refine undo (chips / steering).
 *     Set when a refine starts, restored by `refine-undone`. Survives
 *     hand edits by design.
 *
 * Hand edits bypass exclusions: the user's text is ground truth, so a
 * hand edit clears THAT post's residual violations and nothing
 * recomputes them for user-owned text. Only later MODEL output (a
 * refine pass) carries fresh violations.
 *
 * "Committed" is a lifecycle state, not a corpus event — the all-
 * copied transition signals both, but they are separate facts (see
 * lib/draft/commit.ts for the event half).
 */
import type { Span } from '../exclusion';
import type { ReplyContext } from '../../types';

export type DraftPhase = 'empty' | 'generating' | 'active' | 'committed';

/** One post of the draft — the only post for singles. */
export interface DraftPostContent {
  text: string;
  /** Offsets into THIS post's text. */
  residualViolations: Span[];
  /** Copied to the clipboard since this post's text last changed. */
  copied: boolean;
}

export interface DraftContent {
  /** 'single' renders the classic one-card draft; 'thread' renders
   *  ordered cards. Decided by the generation that produced it. */
  kind: 'single' | 'thread';
  /** Length 1 when kind === 'single'. */
  posts: DraftPostContent[];
  /** The ≈N target that produced / last repacked a thread draft;
   *  null for singles. Carried so the repack control can show and
   *  adjust the draft's actual packaging target. */
  targetCount: number | null;
  wasRepaired: boolean;
  /** True once the user typed in ANY post. Set by `hand-edited`,
   *  reset only when fresh model output replaces the draft. */
  handEdited: boolean;
  /** The bundle that seeded this draft's voice examples (roadmap
   *  Phase 6), or null when the general corpus was sampled. Threaded
   *  EXPLICITLY from the generation request through every reshaping of
   *  the same draft (refines, hand edits) to commit, where auto-filing
   *  reads it — never inferred from panel state at copy time. */
  seedBundleId: string | null;
}

/**
 * Timed-undo snapshot of a replaced/cleared draft. `workbench` is
 * present only when the replacement also cleared the surrounding
 * workbench (a new-context clear): the angle text and the PREVIOUS
 * reply-context lock — possibly null, meaning the draft was a post —
 * so one Undo restores the whole working state exactly as it was. The
 * shell reads it back at restore time (the lock lives in storage, not
 * here). A regenerate replaces only the draft, so its snapshot carries
 * no workbench.
 */
export interface ReplacementSnapshot {
  content: DraftContent;
  workbench: { bullets: string; replyContext: ReplyContext | null } | null;
}

export interface DraftLifecycleState {
  phase: DraftPhase;
  /** Non-null in active/committed. Also retained through `generating`
   *  when a draft already exists (regenerate/refine) so the outgoing
   *  text stays visible while the new one is produced. */
  content: DraftContent | null;
  /** Seq of the one request whose result will be accepted; results
   *  carrying any other seq are stale and ignored. */
  pendingSeq: number | null;
  /** What the in-flight request is — a generate replaces (timed undo),
   *  a refine reshapes (one-level undo). */
  pendingKind: 'generate' | 'refine' | null;
  /** One-level refine undo. */
  refineSnapshot: DraftContent | null;
  /** Timed-undo snapshot. In-panel state only, deliberately not
   *  persisted — a panel close during the undo window means the
   *  replacement stands. */
  replaced: ReplacementSnapshot | null;
}

export const INITIAL_DRAFT_LIFECYCLE: DraftLifecycleState = {
  phase: 'empty',
  content: null,
  pendingSeq: null,
  pendingKind: null,
  refineSnapshot: null,
  replaced: null,
};

/** Model output as the pipeline returns it (every post fresh —
 *  `copied: false`, `handEdited: false` draft-wide). */
export interface ModelDraft {
  kind: 'single' | 'thread';
  posts: { text: string; residualViolations: Span[] }[];
  wasRepaired: boolean;
  /** The ≈N target the generation/repack was asked for; null for
   *  singles. Refines that don't repack leave the draft's own target
   *  in place (the reducer carries it over). */
  targetCount: number | null;
}

export type DraftEvent =
  /** A generate/regenerate request left the panel. */
  | { type: 'generation-started'; seq: number }
  /** A chip / steering refine left the panel. */
  | { type: 'refine-started'; seq: number }
  /** The pipeline returned a draft for request `seq`. `seedBundleId`
   *  is the bundle the GENERATE request was seeded with (absent/null =
   *  sampled); it is ignored for refines, which reshape the same draft
   *  and therefore keep its existing seed. */
  | { type: 'generation-succeeded'; seq: number; draft: ModelDraft; seedBundleId?: string | null }
  /** The pipeline errored for request `seq`. */
  | { type: 'generation-failed'; seq: number }
  /** A SCOPED thread refine landed: fresh model output for exactly one
   *  post (rewrite / aimed chip / aimed steer). Replaces that post —
   *  its copied flag resets, every other post (text, violations,
   *  copied) is untouched. The splice is code-enforced here, never
   *  trusted to the model. */
  | {
      type: 'post-replaced';
      seq: number;
      postIndex: number;
      post: { text: string; residualViolations: Span[] };
      wasRepaired: boolean;
    }
  /** The user typed/deleted/pasted in one post's editor. */
  | { type: 'hand-edited'; postIndex: number; text: string }
  /** One post was copied to the clipboard. When EVERY post is copied,
   *  the draft commits — singles commit on their one copy. */
  | { type: 'post-copied'; postIndex: number }
  /** One-level refine undo. */
  | { type: 'refine-undone' }
  /** The timed-undo toast was clicked. */
  | { type: 'replacement-undone' }
  /** The ~5 s window elapsed (shell timer). */
  | { type: 'replacement-expired' }
  /** A genuinely new reply context arrived (same-tweet re-deliveries
   *  are not new — the shell decides via lib/replyContext identity).
   *  Carries the cleared workbench — the angle text and the previous
   *  lock — so the timed undo restores everything together. */
  | { type: 'new-context'; bullets: string; previousContext: ReplyContext | null }
  /** Explicit discard ("start over"). */
  | { type: 'discarded' };

/** Advance the lifecycle. Unknown/ill-timed events are no-ops — the
 *  reducer is the single authority on what can happen when. */
export function reduceDraftLifecycle(
  state: DraftLifecycleState,
  event: DraftEvent,
): DraftLifecycleState {
  switch (event.type) {
    case 'generation-started':
      // A generate replaces whatever lands after it; the refine undo
      // chain ends here (matches the pre-lifecycle behavior).
      return {
        ...state,
        phase: 'generating',
        pendingSeq: event.seq,
        pendingKind: 'generate',
        refineSnapshot: null,
      };

    case 'refine-started':
      if (state.content === null) return state;
      return {
        ...state,
        phase: 'generating',
        pendingSeq: event.seq,
        pendingKind: 'refine',
        // One-level undo: snapshot what the refine will reshape.
        refineSnapshot: state.content,
        // Refining a just-replaced draft adopts it ("stands if touched").
        replaced: null,
      };

    case 'generation-succeeded': {
      // THE stale gate: only the newest in-flight request may land. A
      // slow earlier generation resolving late must never flip a newer
      // draft back.
      if (state.phase !== 'generating' || event.seq !== state.pendingSeq) return state;
      const fresh: DraftContent = {
        kind: event.draft.kind,
        posts: event.draft.posts.map((p) => ({ ...p, copied: false })),
        wasRepaired: event.draft.wasRepaired,
        handEdited: false,
        // A repack (refine) supplies a fresh target; other refines
        // leave the draft's own target standing. Generates take the
        // event's value (null for singles).
        targetCount:
          state.pendingKind === 'refine'
            ? (event.draft.targetCount ?? state.content?.targetCount ?? null)
            : event.draft.targetCount,
        // A generate stamps the seed from its request; a refine
        // reshapes the SAME draft, so its seed carries over.
        seedBundleId:
          state.pendingKind === 'refine'
            ? (state.content?.seedBundleId ?? null)
            : (event.seedBundleId ?? null),
      };
      return {
        ...state,
        phase: 'active',
        content: fresh,
        pendingSeq: null,
        pendingKind: null,
        // A generate landing over an existing draft is a REPLACEMENT —
        // open the timed-undo window (no workbench payload: a
        // regenerate keeps the angle and lock on screen, so there is
        // nothing beyond the draft to restore). A refine is not a
        // replacement (one-level undo holds it).
        replaced:
          state.pendingKind === 'generate' && state.content !== null
            ? { content: state.content, workbench: null }
            : state.replaced,
      };
    }

    case 'generation-failed':
      if (state.phase !== 'generating' || event.seq !== state.pendingSeq) return state;
      // Keep whatever the user had: the old draft if one was visible,
      // otherwise back to the empty workbench.
      return {
        ...state,
        phase: state.content !== null ? 'active' : 'empty',
        pendingSeq: null,
        pendingKind: null,
      };

    case 'post-replaced': {
      // Same stale gate as generation-succeeded.
      if (state.phase !== 'generating' || event.seq !== state.pendingSeq) return state;
      const base = {
        ...state,
        phase: 'active' as const,
        pendingSeq: null,
        pendingKind: null,
      };
      // An index that no longer exists (defensive — the stale gate
      // should make this unreachable) still resolves the request; the
      // draft is left as it was.
      if (state.content === null || state.content.posts[event.postIndex] === undefined) {
        return { ...base, phase: state.content !== null ? 'active' : 'empty' };
      }
      const posts = state.content.posts.map((p, i) =>
        i === event.postIndex ? { ...event.post, copied: false } : p,
      );
      return {
        ...base,
        content: {
          ...state.content,
          posts,
          wasRepaired: state.content.wasRepaired || event.wasRepaired,
        },
      };
    }

    case 'hand-edited': {
      if (state.content === null || state.phase === 'generating' || state.phase === 'empty') {
        return state;
      }
      const post = state.content.posts[event.postIndex];
      if (post === undefined) return state;
      const posts = state.content.posts.map((p, i) =>
        i === event.postIndex
          ? {
              text: event.text,
              // Hand edits bypass exclusions — the model-output
              // violations no longer map onto user-owned text (offsets
              // shifted, and the user's words are ground truth anyway).
              residualViolations: [],
              // The clipboard no longer holds this text.
              copied: false,
            }
          : p,
      );
      return {
        ...state,
        // Editing a committed draft un-commits it: there are now
        // uncopied changes, and they should ride through the next copy.
        phase: 'active',
        content: { ...state.content, posts, handEdited: true },
        // Touching the new draft adopts it; the replacement stands.
        replaced: null,
        // The refine snapshot deliberately survives hand edits.
      };
    }

    case 'post-copied': {
      if (state.content === null || state.phase === 'generating' || state.phase === 'empty') {
        return state;
      }
      const post = state.content.posts[event.postIndex];
      if (post === undefined) return state;
      const posts = state.content.posts.map((p, i) =>
        i === event.postIndex ? { ...p, copied: true } : p,
      );
      const allCopied = posts.every((p) => p.copied);
      // THE commit rule: every post copied since its last change ⇒
      // committed (resolving both undo scopes). Singles are the N=1
      // case. The corpus event is the caller's job — separate fact.
      return {
        ...state,
        phase: allCopied ? 'committed' : state.phase,
        content: { ...state.content, posts },
        replaced: allCopied ? null : state.replaced,
        refineSnapshot: allCopied ? null : state.refineSnapshot,
      };
    }

    case 'refine-undone':
      if (state.refineSnapshot === null || state.phase === 'generating') return state;
      return {
        ...state,
        phase: 'active',
        content: state.refineSnapshot,
        refineSnapshot: null,
      };

    case 'replacement-undone':
      if (state.replaced === null) return state;
      return {
        ...state,
        // Restored drafts come back active (editable) even if they were
        // committed before being replaced — they're work-in-hand again.
        // (The shell reads the snapshot's workbench before dispatching
        // to restore the cleared angle text alongside.)
        phase: 'active',
        content: state.replaced.content,
        replaced: null,
      };

    case 'replacement-expired':
      return state.replaced === null ? state : { ...state, replaced: null };

    case 'new-context':
      // A genuinely new reply context clears the workbench — draft AND
      // the angle text written for the old context (guarded together
      // by the timed undo) — and invalidates any in-flight request,
      // whose result was for the old context.
      if (state.content === null && state.phase !== 'generating') return state;
      return {
        phase: 'empty',
        content: null,
        pendingSeq: null,
        pendingKind: null,
        refineSnapshot: null,
        replaced:
          state.content !== null
            ? {
                content: state.content,
                workbench: { bullets: event.bullets, replyContext: event.previousContext },
              }
            : state.replaced,
      };

    case 'discarded':
      return INITIAL_DRAFT_LIFECYCLE;
  }
}
