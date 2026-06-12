import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../types';
import { selectExamples, type SamplingOptions } from './selectExamples';

function item(
  id: string,
  type: LibraryItem['type'],
  overrides: Partial<LibraryItem> = {},
): LibraryItem {
  return {
    id,
    text: id,
    type,
    source: 'manual',
    authorHandle: 'me',
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
    favorite: false,
    embedding: null,
    createdAt: 0,
    ...overrides,
  };
}

/** Deterministic RNG: sequence of values from `[0, 1)`. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i++;
    return v;
  };
}

function opts(overrides: Partial<SamplingOptions> = {}): SamplingOptions {
  return { poolSize: 10, starCount: 4, curatedShare: 0.7, rng: seqRng([0]), ...overrides };
}

const ids = (items: LibraryItem[]): string[] => items.map((i) => i.id).sort();

describe('selectExamples — mode filter and budget', () => {
  it('filters by mode in both pools', () => {
    const lib = [
      item('p1', 'post'),
      item('r1', 'reply', { favorite: true }),
      item('r2', 'reply'),
      item('p2', 'post', { favorite: true }),
    ];
    const out = selectExamples('reply', {}, lib, opts());
    expect(ids(out.aspirational)).toEqual(['r1']);
    expect(ids(out.voice)).toEqual(['r2']);
  });

  it('caps voice at poolSize and returns everything when the library is smaller', () => {
    const big = Array.from({ length: 30 }, (_, n) => item(`p${String(n)}`, 'post'));
    expect(selectExamples('post', {}, big, opts({ poolSize: 5 })).voice).toHaveLength(5);

    const small = [item('p1', 'post'), item('p2', 'post')];
    const out = selectExamples('post', {}, small, opts({ poolSize: 20 }));
    expect(out.voice).toHaveLength(2);
  });

  it('returns empty pools when nothing matches the mode', () => {
    const out = selectExamples('post', {}, [item('r1', 'reply')], opts());
    expect(out.aspirational).toEqual([]);
    expect(out.voice).toEqual([]);
  });
});

describe('selectExamples — the star pool', () => {
  it('GUARANTEES starred items in every prompt, additive to poolSize', () => {
    const lib = [
      item('s1', 'post', { favorite: true }),
      item('s2', 'post', { favorite: true }),
      ...Array.from({ length: 20 }, (_, n) => item(`p${String(n)}`, 'post')),
    ];
    const out = selectExamples('post', {}, lib, opts({ poolSize: 10, starCount: 4 }));
    expect(ids(out.aspirational)).toEqual(['s1', 's2']);
    expect(out.voice).toHaveLength(10); // stars did not eat the budget
  });

  it('caps the star pool at floor(poolSize / 2) regardless of the setting', () => {
    const lib = [
      ...Array.from({ length: 9 }, (_, n) => item(`s${String(n)}`, 'post', { favorite: true })),
      ...Array.from({ length: 9 }, (_, n) => item(`p${String(n)}`, 'post')),
    ];
    const out = selectExamples('post', {}, lib, opts({ poolSize: 5, starCount: 9 }));
    expect(out.aspirational).toHaveLength(2); // floor(5/2)
  });

  it('shuffles among all stars — different rng, different picks', () => {
    const lib = Array.from({ length: 6 }, (_, n) =>
      item(`s${String(n)}`, 'post', { favorite: true }),
    );
    const a = selectExamples('post', {}, lib, opts({ starCount: 2, rng: seqRng([0]) }));
    const b = selectExamples('post', {}, lib, opts({ starCount: 2, rng: seqRng([0.9, 0.7, 0.5]) }));
    expect(ids(a.aspirational)).not.toEqual(ids(b.aspirational));
  });

  it('never selects a starred archive row (defensive boundary)', () => {
    const lib = [item('a1', 'post', { source: 'archive', favorite: true })];
    const out = selectExamples('post', {}, lib, opts());
    expect(out.aspirational).toEqual([]);
    expect(ids(out.voice)).toEqual(['a1']); // still sampleable as archive
  });

  it('no item appears twice — selected stars are excluded from voice', () => {
    const lib = [item('s1', 'post', { favorite: true }), item('p1', 'post'), item('p2', 'post')];
    const out = selectExamples('post', {}, lib, opts({ poolSize: 10 }));
    expect(ids(out.aspirational)).toEqual(['s1']);
    expect(out.voice.some((i) => i.id === 's1')).toBe(false);
    expect(ids(out.voice)).toEqual(['p1', 'p2']);
  });

  it('an unselected star (over budget) may still appear in voice — it is not lost', () => {
    const lib = [
      ...Array.from({ length: 5 }, (_, n) => item(`s${String(n)}`, 'post', { favorite: true })),
    ];
    const out = selectExamples('post', {}, lib, opts({ poolSize: 4, starCount: 2 }));
    expect(out.aspirational).toHaveLength(2);
    expect(out.voice).toHaveLength(3); // the other three sample normally
  });
});

describe('selectExamples — bundle-seeded (Phase 6)', () => {
  it('bundle members ARE the voice pool — verbatim, in bundle order, unshuffled', () => {
    const lib = [
      item('a', 'post'),
      item('b', 'post'),
      item('c', 'post'),
      ...Array.from({ length: 20 }, (_, n) => item(`p${String(n)}`, 'post')),
    ];
    const out = selectExamples('post', {}, lib, opts({ bundleMemberIds: ['c', 'a', 'b'] }));
    expect(out.voice.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('runs lean under budget — never tops up from the general pool', () => {
    const lib = [
      item('m1', 'post'),
      ...Array.from({ length: 30 }, (_, n) => item(`p${String(n)}`, 'post')),
    ];
    const out = selectExamples('post', {}, lib, opts({ poolSize: 20, bundleMemberIds: ['m1'] }));
    expect(out.voice.map((i) => i.id)).toEqual(['m1']);
  });

  it('takes every member over budget — an explicit selection is its own budget', () => {
    const memberIds = Array.from({ length: 12 }, (_, n) => `m${String(n)}`);
    const lib = memberIds.map((id) => item(id, 'post'));
    const out = selectExamples('post', {}, lib, opts({ poolSize: 5, bundleMemberIds: memberIds }));
    expect(out.voice).toHaveLength(12);
  });

  it('does not mode-filter members — the user picked every one', () => {
    const lib = [item('r1', 'reply'), item('p1', 'post')];
    const out = selectExamples('post', {}, lib, opts({ bundleMemberIds: ['r1', 'p1'] }));
    expect(out.voice.map((i) => i.id)).toEqual(['r1', 'p1']);
  });

  it('drops dangling ids, preserving the order of the rest', () => {
    const lib = [item('a', 'post'), item('b', 'post')];
    const out = selectExamples('post', {}, lib, opts({ bundleMemberIds: ['b', 'deleted', 'a'] }));
    expect(out.voice.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('stars still ride on top, minus bundle members (the bundle keeps its items)', () => {
    const lib = [
      item('s1', 'post', { favorite: true }),
      item('s2', 'post', { favorite: true }),
      item('m1', 'post'),
    ];
    const out = selectExamples('post', {}, lib, opts({ bundleMemberIds: ['m1', 's1'] }));
    expect(out.voice.map((i) => i.id)).toEqual(['m1', 's1']); // starred member stays a member
    expect(ids(out.aspirational)).toEqual(['s2']); // only the non-member star
  });

  it('an empty (or all-dangling) bundle runs with no voice examples — not a sample', () => {
    const lib = Array.from({ length: 10 }, (_, n) => item(`p${String(n)}`, 'post'));
    const out = selectExamples('post', {}, lib, opts({ bundleMemberIds: [] }));
    expect(out.voice).toEqual([]);
  });
});

describe('selectExamples — curated/archive tiers', () => {
  const curatedN = (n: number) =>
    Array.from({ length: n }, (_, i) => item(`c${String(i)}`, 'post', { source: 'manual' }));
  const shippedN = (n: number) =>
    Array.from({ length: n }, (_, i) => item(`sh${String(i)}`, 'post', { source: 'shipped' }));
  const archiveN = (n: number) =>
    Array.from({ length: n }, (_, i) => item(`a${String(i)}`, 'post', { source: 'archive' }));

  it('splits the budget per curatedShare when both tiers are plentiful', () => {
    const out = selectExamples('post', {}, [...curatedN(20), ...archiveN(20)], opts());
    const curated = out.voice.filter((i) => i.source !== 'archive');
    const archive = out.voice.filter((i) => i.source === 'archive');
    expect(curated).toHaveLength(7); // round(10 * 0.7)
    expect(archive).toHaveLength(3);
  });

  it("counts 'shipped' in the curated tier", () => {
    const out = selectExamples(
      'post',
      {},
      [...curatedN(4), ...shippedN(4), ...archiveN(20)],
      opts(),
    );
    const curated = out.voice.filter((i) => i.source !== 'archive');
    expect(curated).toHaveLength(7); // 4 manual + 3 shipped or similar mix
  });

  it('archive tops up what curated cannot fill', () => {
    const out = selectExamples('post', {}, [...curatedN(2), ...archiveN(20)], opts());
    expect(out.voice.filter((i) => i.source !== 'archive')).toHaveLength(2);
    expect(out.voice.filter((i) => i.source === 'archive')).toHaveLength(8);
  });

  it('curated tops back up what archive cannot fill', () => {
    const out = selectExamples('post', {}, [...curatedN(20), ...archiveN(1)], opts());
    expect(out.voice.filter((i) => i.source === 'archive')).toHaveLength(1);
    expect(out.voice.filter((i) => i.source !== 'archive')).toHaveLength(9);
  });

  it('zero archive degrades to curated-only (the pre-tier behavior)', () => {
    const out = selectExamples('post', {}, curatedN(20), opts());
    expect(out.voice).toHaveLength(10);
    expect(out.voice.every((i) => i.source !== 'archive')).toBe(true);
  });

  it('zero curated lets archive fill the whole budget', () => {
    const out = selectExamples('post', {}, archiveN(20), opts());
    expect(out.voice).toHaveLength(10);
    expect(out.voice.every((i) => i.source === 'archive')).toBe(true);
  });

  it('a tiny library returns everything once, no stars, no padding', () => {
    const lib = [item('p1', 'post'), item('a1', 'post', { source: 'archive' })];
    const out = selectExamples('post', {}, lib, opts());
    expect(out.aspirational).toEqual([]);
    expect(ids(out.voice)).toEqual(['a1', 'p1']);
  });
});
