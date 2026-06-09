/**
 * Example sampling — the CLAUDE.md §8 seam.
 *
 * v1 implementation: filter the library by mode (reply-mode samples
 * reply items; post-mode samples post items), shuffle, return up to
 * `poolSize` items. If fewer matching items exist, return all of them.
 *
 * Later phases swap the shuffle for semantic retrieval behind THIS
 * exact signature so callers do not change. The `context` argument is
 * accepted now (and ignored) so retrieval has somewhere to read parent
 * tweet / bullets / mode-specific cues from when it lands.
 */
import type { LibraryItem } from '../../types';

export type GenerationMode = 'post' | 'reply';

export interface SamplingContext {
  /** The tweet being replied to (reply mode). v1 unused. */
  parentText?: string;
  /** The tweet directly above the parent in a thread (reply mode). v1 unused. */
  grandparentText?: string;
  /** The user's bullets describing what to say. v1 unused. */
  bullets?: string;
}

export interface SamplingOptions {
  /** Upper bound on the number of examples returned. */
  poolSize: number;
  /**
   * Random number generator in `[0, 1)`. Defaults to `Math.random`.
   * Injected for deterministic tests.
   */
  rng?: () => number;
}

export function selectExamples(
  mode: GenerationMode,
  _context: SamplingContext,
  library: LibraryItem[],
  options: SamplingOptions,
): LibraryItem[] {
  const matching = library.filter((item) => item.type === mode);
  if (matching.length === 0) return [];
  const rng = options.rng ?? Math.random;
  const shuffled = shuffleInPlace([...matching], rng);
  const cap = Math.max(0, options.poolSize);
  return shuffled.slice(0, cap);
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
