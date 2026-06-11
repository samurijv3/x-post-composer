/**
 * Cross-context types for the generation pipeline.
 *
 * `ReplyContext` is what the content script extracts from around X's
 * open composer and hands to the background. `GenerationRequest` is
 * what the panel sends to the background. `GenerationResult` is what
 * comes back — including the residual violation spans so the UI can
 * highlight any patterns that survived auto-fix + the one repair pass.
 */
import type { Span } from '../lib/exclusion/types';
import type { Draft } from './draft';

export interface ReplyContext {
  /** The tweet being replied to (always present in reply mode). */
  targetText: string;
  /** Author handle of the target tweet, when readable. Display-only. */
  targetAuthorHandle: string | null;
  /** Author display name of the target tweet, when readable. Display-only. */
  targetAuthorDisplayName: string | null;
  /** Avatar URL on `pbs.twimg.com`. See CLAUDE.md §6 for the inbound-image
   *  carve-out. Display-only. */
  targetAuthorAvatarUrl: string | null;
  /** ISO 8601 publish time of the target tweet. Display-only. */
  targetTimestamp: string | null;
  /** Status id of the target tweet, when readable from the permalink
   *  anchor's href. Used by the highlight overlay to re-find the
   *  article after X's virtual scroll unmounts and remounts it. */
  targetStatusId: string | null;
  /** The tweet that the target was itself a reply to (one level up).
   *  Null when the target is a top-level post. */
  grandparentText: string | null;
  /** True when the captured payload has any media/quote-tweet that we
   *  could not read. Surfaced as a one-line note so users know what
   *  text-only capture missed. */
  hadUnreadableMedia: boolean;
}

export interface GenerationRequest {
  mode: 'post' | 'reply';
  /** Free-text bullets describing what the user wants to say. */
  bullets: string;
  /** Per-composition character constraint. When true → ≤280. When
   *  false → soft cap from `Settings.softCapChars`. */
  charCap: boolean;
  /** Only present in reply mode. */
  replyContext: ReplyContext | null;
  /** Set by the Regenerate control. When true, the pipeline uses
   *  `Settings.temperature.regenerate` (~0.9) instead of `.generate`
   *  (~0.7) so the new draft is noticeably different from the last. */
  isRegenerate?: boolean;
}

/**
 * The shape sent by the panel when refining an existing draft.
 * `kind` discriminates the entry point — a chip click, the freeform
 * feedback box, or one of the code-supplied passes (polish / refit);
 * every kind renders through the single refine template with its full
 * voice anchor. The background looks up chips by id against current
 * Settings so any edit the user just made is always honoured.
 * In-flight only — never stored, so reshaping it needs no migration.
 */
export interface RefineRequest {
  /** Mode of the original generation (used by `setLastPrompt` only). */
  mode: 'post' | 'reply';
  /** The on-screen draft text that this refine is reshaping. */
  previousDraftText: string;
  /** Same constraint as the original composition. */
  charCap: boolean;
  kind: RefineKind;
}

export type RefineKind =
  | {
      type: 'chip';
      chipId: string;
      /** How many times the user has clicked this chip in the current
       *  session (1 on first press, 2 on second, etc.). The background
       *  escalates the wording of the chip's instruction based on this
       *  so repeated presses produce compounding effects rather than
       *  the AI shrugging off subsequent identical asks. */
      intensity: number;
    }
  /** Typed feedback from the freeform box — the instruction verbatim. */
  | { type: 'freeform'; instruction: string }
  /** The Polish button — code-supplied instruction (POLISH_INSTRUCTION). */
  | { type: 'polish' }
  /** The ≤280 toggle flipped ON over an over-limit draft — a refit,
   *  never a regenerate (REFIT_INSTRUCTION). */
  | { type: 'refit' };

export interface GenerationResultOk {
  ok: true;
  draft: Draft;
  /** Spans (in the FIRST-PASS draft text) that auto-fix rewrote.
   *  Useful for logging / inspection; not surfaced in the main UI. */
  appliedAutoFixes: Span[];
  /** Spans (in the FINAL draft text) that survived auto-fix + repair.
   *  The UI highlights these so the user can hand-edit. */
  residualViolations: Span[];
  /** True when a repair re-prompt fired. */
  wasRepaired: boolean;
}

export interface GenerationResultErr {
  ok: false;
  /** Distinct enough for the UI to choose wording. */
  kind: 'auth' | 'rate-limit' | 'network' | 'server' | 'bad-request' | 'other';
  message: string;
}

export type GenerationResult = GenerationResultOk | GenerationResultErr;
