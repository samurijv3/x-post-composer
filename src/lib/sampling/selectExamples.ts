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
 *   THREAD MODE (roadmap Phase 10): thread examples fill the voice
 *     budget FIRST — each thread debiting `poolSize` by its segment
 *     count (tweet-equivalent budget, so a thread library can't
 *     quietly balloon prompts) — and POSTS top up the remainder
 *     through the same curated/archive tier math (broadcast register;
 *     replies teach conversation, not threads). Starred threads are
 *     guaranteed first within the thread fill; the first thread is
 *     always taken even when over budget (a thread prompt with zero
 *     thread exemplars while they exist would be worse than an
 *     overshoot); a thread that doesn't fit is skipped individually
 *     and the walk continues (a smaller one later may fit). The
 *     aspirational pool in thread mode is starred POSTS — the prose
 *     bar, register-appropriate — never joined threads. Thread items
 *     stay OUT of post/reply sampling by the type filter.
 *
 * Later phases swap the shuffle for semantic retrieval behind THIS
 * exact signature so callers do not change. The `context` argument is
 * accepted now (and ignored) so retrieval has somewhere to read parent
 * tweet / bullets / mode-specific cues from when it lands.
 */
import type { LibraryItem } from '../../types';
import { resolveBundleMembers } from '../bundles';

export type GenerationMode = 'post' | 'reply' | 'thread';

export interface SamplingContext {
  /** The tweet being replied to (reply mode). Unused until retrieval. */
  parentText?: string;
  /** The tweet directly above the parent in a thread (reply mode). Unused until retrieval. */
  grandparentText?: string;
  /** The user's bullets describing what to say. Unused until retrieval. */
  bullets?: string;
}

export interface SamplingOptions {
  /** Budget for the sampled (non-star) tiers combined. In thread mode
   *  this is a TWEET-equivalent budget: each thread debits it by its
   *  segment count. */
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
  /** The guaranteed star pool → <aspirational_examples>. Starred
   *  posts in thread mode (the prose bar); type-matched otherwise. */
  aspirational: LibraryItem[];
  /** The curated+archive sample → <voice_examples>. */
  voice: LibraryItem[];
  /** Thread exemplars → <thread_examples>. Always [] outside thread
   *  mode. */
  threads: LibraryItem[];
}

export function selectExamples(
  mode: GenerationMode,
  _context: SamplingContext,
  library: LibraryItem[],
  options: SamplingOptions,
): SelectedExamples {
  const rng = options.rng ?? Math.random;
  const poolSize = Math.max(0, options.poolSize);
  const starBudget = Math.min(Math.max(0, options.starCount), Math.floor(poolSize / 2));

  if (mode === 'thread') {
    return selectForThread(library, options, rng, poolSize, starBudget);
  }

  const matching = library.filter((item) => item.type === mode);

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
      threads: [],
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
  return {
    aspirational,
    voice: sampleTiers(sampled, poolSize, options.curatedShare, rng),
    threads: [],
  };
}

/** Thread-mode selection — see the THREAD MODE section of the header. */
function selectForThread(
  library: LibraryItem[],
  options: SamplingOptions,
  rng: () => number,
  poolSize: number,
  starBudget: number,
): SelectedExamples {
  // Bundle-seeded thread mode: members verbatim, split into their
  // natural blocks; stars-minus-members from posts (the prose bar),
  // consistent with the sampled path below.
  if (options.bundleMemberIds !== undefined) {
    const { members } = resolveBundleMembers(options.bundleMemberIds, library);
    const memberIds = new Set(members.map((item) => item.id));
    const stars = library.filter(
      (item) =>
        item.type === 'post' &&
        item.favorite &&
        item.source !== 'archive' &&
        !memberIds.has(item.id),
    );
    return {
      aspirational: shuffleInPlace([...stars], rng).slice(0, starBudget),
      voice: members.filter((item) => item.type !== 'thread'),
      threads: members.filter((item) => item.type === 'thread'),
    };
  }

  // Threads fill first. Starred threads are guaranteed ahead of the
  // rest (the star semantic — guaranteed presence — applied
  // type-appropriately; they never render in the aspirational block).
  const allThreads = library.filter((item) => item.type === 'thread');
  const orderedThreads = [
    ...shuffleInPlace(
      allThreads.filter((t) => t.favorite),
      rng,
    ),
    ...shuffleInPlace(
      allThreads.filter((t) => !t.favorite),
      rng,
    ),
  ];
  const threads: LibraryItem[] = [];
  let remaining = poolSize;
  for (const thread of orderedThreads) {
    const cost = thread.segments?.length ?? 1;
    // First thread always taken (even over budget); later ones are
    // skipped individually when they don't fit — keep walking, a
    // smaller thread may still fit.
    if (threads.length === 0 || cost <= remaining) {
      threads.push(thread);
      remaining = Math.max(0, remaining - cost);
    }
  }

  // Post top-up: the prose register threads are made of. Starred posts
  // form the aspirational pool exactly as in post mode.
  const posts = library.filter((item) => item.type === 'post');
  const stars = posts.filter((item) => item.favorite && item.source !== 'archive');
  const aspirational = shuffleInPlace([...stars], rng).slice(0, starBudget);
  const starred = new Set(aspirational.map((item) => item.id));
  const sampled = posts.filter((item) => !starred.has(item.id));
  return {
    aspirational,
    voice: sampleTiers(sampled, remaining, options.curatedShare, rng),
    threads,
  };
}

/**
 * The curated-first / archive-top-up tier math over one budget —
 * shared by the post/reply sample and the thread-mode post top-up.
 * Curated fills to its share first, archive tops up the remainder, and
 * whatever archive can't supply flows back to curated; zero archive
 * items reproduces curated-only behavior exactly.
 */
function sampleTiers(
  sampled: LibraryItem[],
  budget: number,
  curatedShare: number,
  rng: () => number,
): LibraryItem[] {
  const curated = sampled.filter((item) => item.source !== 'archive');
  const archive = sampled.filter((item) => item.source === 'archive');
  const curatedTarget = Math.round(budget * clamp01(curatedShare));
  const archiveTake = Math.min(archive.length, budget - Math.min(curated.length, curatedTarget));
  const curatedTake = Math.min(curated.length, budget - archiveTake);

  return shuffleInPlace(
    [
      ...shuffleInPlace([...curated], rng).slice(0, curatedTake),
      ...shuffleInPlace([...archive], rng).slice(0, archiveTake),
    ],
    rng,
  );
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
