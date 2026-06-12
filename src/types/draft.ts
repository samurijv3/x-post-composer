/**
 * A draft is always an array of posts — the CLAUDE.md §8 seam, finally
 * exercised: length 1 for single posts/replies, N for threads
 * (roadmap Phase 10).
 */
import type { Span } from '../lib/exclusion/types';

export interface PostDraft {
  /** The candidate post text. */
  text: string;
  /** X-weighted character count (twitter-text), set by the pipeline. */
  characterCount?: number;
  /** Exclusion violations that survived auto-fix + the repair pass,
   *  offsets into THIS post's text. The UI highlights them per post. */
  residualViolations: Span[];
}

export interface Draft {
  /** Ordered posts: one for singles, the thread's segments otherwise. */
  posts: PostDraft[];
}
