import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../types';
import { selectExamples } from './selectExamples';

function item(id: string, type: LibraryItem['type'], text = id): LibraryItem {
  return {
    id,
    text,
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

describe('selectExamples', () => {
  it('filters by mode — reply mode returns only reply items', () => {
    const lib = [item('p1', 'post'), item('r1', 'reply'), item('r2', 'reply'), item('p2', 'post')];
    const out = selectExamples('reply', {}, lib, { poolSize: 10 });
    expect(out.map((i) => i.id).sort()).toEqual(['r1', 'r2']);
  });

  it('filters by mode — post mode returns only post items', () => {
    const lib = [item('p1', 'post'), item('r1', 'reply'), item('p2', 'post')];
    const out = selectExamples('post', {}, lib, { poolSize: 10 });
    expect(out.map((i) => i.id).sort()).toEqual(['p1', 'p2']);
  });

  it('caps the result at poolSize', () => {
    const lib = Array.from({ length: 30 }, (_, n) => item(`p${String(n)}`, 'post'));
    const out = selectExamples('post', {}, lib, { poolSize: 5 });
    expect(out).toHaveLength(5);
  });

  it('returns all matching items when fewer exist than poolSize', () => {
    const lib = [item('p1', 'post'), item('p2', 'post')];
    const out = selectExamples('post', {}, lib, { poolSize: 20 });
    expect(out).toHaveLength(2);
  });

  it('returns empty when no items match the mode', () => {
    const lib = [item('r1', 'reply')];
    expect(selectExamples('post', {}, lib, { poolSize: 5 })).toEqual([]);
  });

  it('returns empty when the library is empty', () => {
    expect(selectExamples('reply', {}, [], { poolSize: 5 })).toEqual([]);
  });

  it('shuffles — different rngs produce different orderings', () => {
    const lib = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, 'post'));
    const ascending = selectExamples('post', {}, lib, {
      poolSize: 10,
      rng: seqRng([0, 0, 0, 0]),
    });
    const reversed = selectExamples('post', {}, lib, {
      poolSize: 10,
      rng: seqRng([0.99, 0.99, 0.99, 0.99]),
    });
    expect(ascending.map((i) => i.id)).not.toEqual(reversed.map((i) => i.id));
    expect(ascending.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(reversed.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not mutate the input library', () => {
    const lib = [item('a', 'post'), item('b', 'post'), item('c', 'post')];
    const snapshot = lib.map((i) => i.id);
    selectExamples('post', {}, lib, { poolSize: 10 });
    expect(lib.map((i) => i.id)).toEqual(snapshot);
  });

  it('treats negative or zero poolSize as zero', () => {
    const lib = [item('a', 'post')];
    expect(selectExamples('post', {}, lib, { poolSize: 0 })).toEqual([]);
    expect(selectExamples('post', {}, lib, { poolSize: -3 })).toEqual([]);
  });
});
