/**
 * Example sampling — the CLAUDE.md §8 seam, implementing the roadmap's
 * Core Concept A model:
 *
 *   STARS, on top (own pool): up to `starCount` favorited items,
 *     shuffled among all stars, GUARANTEED in every prompt, additive to
 *     `poolSize`. Hard-capped at floor(poolSize / 2) so stars can never
 *     exceed a third of the total examples — the canon must not drown
 *     out range. Feeds <aspirational_examples>.
 *
 *   CURATED tier ('manual' + 'shipped', filled first) and ARCHIVE tier
 *     (the noisy backstop) share the `poolSize` budget per
 *     `curatedShare` (default 0.7). Whichever tier can't fill its
 *     share, the other tops up — with zero archive items the math
 *     degrades naturally to curated-only. Feeds <voice_examples>.
 *
 *   No item appears twice: stars are excluded from the tier pools.
 *
 *   BUNDLE-SEEDED (roadmap Phase 6): when `bundleMemberIds` is given,
 *     the bundle IS the voice pool — its resolved members, verbatim, in
 *     bundle order, replacing the sampled tiers entirely. The bundle is
 *     user-controlled retrieval, so nothing about it is probabilistic:
 *     no shuffle, no mode filter (the user picked every member), no cap,
 *     and no top-up from the general pool when it runs under budget —
 *     targeted-and-lean beats automatic breadth. Stars still ride on
 *     top (the bar is the bar), minus any star that is itself a bundle
 *     member — the bundle keeps its members; the no-item-twice rule
 *     resolves in the bundle's favor.
 *
 * Later phases swap the shuffle for semantic retrieval behind THIS
 * exact signature so callers do not change. The `context` argument is
 * accepted now (and ignored) so retrieval has somewhere to read parent
 * tweet / bullets / mode-specific cues from when it lands.
 */
import type { LibraryItem } from '../../types';
import { resolveBundleMembers } from '../bundles';

export type GenerationMode = 'post' | 'reply';

export interface SamplingContext {
  /** The tweet being replied to (reply mode). Unused until retrieval. */
  parentText?: string;
  /** The tweet directly above the parent in a thread (reply mode). Unused until retrieval. */
  grandparentText?: string;
  /** The user's bullets describing what to say. Unused until retrieval. */
  bullets?: string;
}

export interface SamplingOptions {
  /** Budget for the sampled (non-star) tiers combined. */
  poolSize: number;
  /** How many starred items ride on top (additive to poolSize). The
   *  effective number is capped at floor(poolSize / 2). */
  starCount: number;
  /** Curated tier's share of `poolSize`, 0..1 (default 0.7). Inert in
   *  practice until archive items exist (Phase 7). */
  curatedShare: number;
  /** Ordered member ids of the bundle seeding this generation. When
   *  present (even empty), the resolved members replace the sampled
   *  voice pool — see the header. Dangling ids drop at resolution. */
  bundleMemberIds?: string[];
  /**
   * Random number generator in `[0, 1)`. Defaults to `Math.random`.
   * Injected for deterministic tests.
   */
  rng?: () => number;
}

export interface SelectedExamples {
  /** The guaranteed star pool → <aspirational_examples>. */
  aspirational: LibraryItem[];
  /** The curated+archive sample → <voice_examples>. */
  voice: LibraryItem[];
}

export function selectExamples(
  mode: GenerationMode,
  _context: SamplingContext,
  library: LibraryItem[],
  options: SamplingOptions,
): SelectedExamples {
  const rng = options.rng ?? Math.random;
  const poolSize = Math.max(0, options.poolSize);
  const matching = library.filter((item) => item.type === mode);
  const starBudget = Math.min(Math.max(0, options.starCount), Math.floor(poolSize / 2));

  // Bundle-seeded: the bundle IS the voice pool (see the header). Stars
  // still ride on top, minus members — the bundle keeps its items.
  if (options.bundleMemberIds !== undefined) {
    const { members } = resolveBundleMembers(options.bundleMemberIds, library);
    const memberIds = new Set(members.map((item) => item.id));
    const stars = matching.filter(
      (item) => item.favorite && item.source !== 'archive' && !memberIds.has(item.id),
    );
    return {
      aspirational: shuffleInPlace([...stars], rng).slice(0, starBudget),
      voice: members,
    };
  }

  // Stars first — their own pool, guaranteed presence. The archive
  // guard is defensive: the starring boundary already prevents
  // favorited archive rows, but the sampler encodes the rule too.
  const stars = matching.filter((item) => item.favorite && item.source !== 'archive');
  const aspirational = shuffleInPlace([...stars], rng).slice(0, starBudget);
  const starred = new Set(aspirational.map((item) => item.id));

  // The sampled tiers split what's left. No item appears twice in one
  // prompt, so anything already starred-in is excluded here.
  const sampled = matching.filter((item) => !starred.has(item.id));
  const curated = sampled.filter((item) => item.source !== 'archive');
  const archive = sampled.filter((item) => item.source === 'archive');

  // Curated fills first, up to its share; archive tops up the rest;
  // whatever archive can't supply flows back to curated. With zero
  // archive items this is exactly the pre-tier curated-only behavior.
  const curatedTarget = Math.round(poolSize * clamp01(options.curatedShare));
  const archiveTake = Math.min(archive.length, poolSize - Math.min(curated.length, curatedTarget));
  const curatedTake = Math.min(curated.length, poolSize - archiveTake);

  const voice = shuffleInPlace(
    [
      ...shuffleInPlace([...curated], rng).slice(0, curatedTake),
      ...shuffleInPlace([...archive], rng).slice(0, archiveTake),
    ],
    rng,
  );

  return { aspirational, voice };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Fisher–Yates shuffle. Mutates the array; caller passes a copy. */
function shuffleInPlace<T>(array: T[], rng: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const ai = array[i];
    const aj = array[j];
    if (ai !== undefined && aj !== undefined) {
      array[i] = aj;
      array[j] = ai;
    }
  }
  return array;
}
