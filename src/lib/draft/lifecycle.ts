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
 * hand edit clears residual violations and nothing recomputes them for
 * user-owned text. Only later MODEL output (a refine pass) carries
 * fresh violations.
 *
 * "Committed" is a lifecycle state, not a corpus event — copy signals
 * both, but they are separate facts (see lib/draft/commit.ts for the
 * event half).
 */
import type { Span } from '../exclusion';
import type { ReplyContext } from '../../types';

export type DraftPhase = 'empty' | 'generating' | 'active' | 'committed';

export interface DraftContent {
  text: string;
  residualViolations: Span[];
  wasRepaired: boolean;
  /** True once the user typed in the draft. Set by `hand-edited`,
   *  reset only when fresh model output replaces the text. */
  handEdited: boolean;
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

/** Model output as the pipeline returns it (always `handEdited: false`). */
export interface ModelDraft {
  text: string;
  residualViolations: Span[];
  wasRepaired: boolean;
}

export type DraftEvent =
  /** A generate/regenerate request left the panel. */
  | { type: 'generation-started'; seq: number }
  /** A chip / steering refine left the panel. */
  | { type: 'refine-started'; seq: number }
  /** The pipeline returned a draft for request `seq`. */
  | { type: 'generation-succeeded'; seq: number; draft: ModelDraft }
  /** The pipeline errored for request `seq`. */
  | { type: 'generation-failed'; seq: number }
  /** The user typed/deleted/pasted in the draft editor. */
  | { type: 'hand-edited'; text: string }
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
  /** Copy-to-X. Resolves the timed undo and the refine snapshot. */
  | { type: 'committed' }
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
      const fresh: DraftContent = { ...event.draft, handEdited: false };
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

    case 'hand-edited': {
      if (state.content === null || state.phase === 'generating' || state.phase === 'empty') {
        return state;
      }
      return {
        ...state,
        // Editing a committed draft un-commits it: there are now
        // uncopied changes, and they should ride through the next copy.
        phase: 'active',
        content: {
          text: event.text,
          // Hand edits bypass exclusions — the model-output violations
          // no longer map onto user-owned text (offsets shifted, and
          // the user's words are ground truth anyway).
          residualViolations: [],
          wasRepaired: state.content.wasRepaired,
          handEdited: true,
        },
        // Touching the new draft adopts it; the replacement stands.
        replaced: null,
        // The refine snapshot deliberately survives hand edits.
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
        // (The shell reads `replaced.bullets` before dispatching to
        // restore the cleared angle text alongside.)
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

    case 'committed':
      if (state.phase !== 'active' || state.content === null) return state;
      // Commit resolves the pending timed undo and ends the refine
      // chain. (The corpus event is the caller's job — separate fact.)
      return {
        ...state,
        phase: 'committed',
        replaced: null,
        refineSnapshot: null,
      };

    case 'discarded':
      return INITIAL_DRAFT_LIFECYCLE;
  }
}
