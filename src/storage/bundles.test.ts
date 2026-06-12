import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Bundle } from '../types';
import { _resetCorpusCache } from './corpus';
import { addBundle, deleteBundle, getAllBundles, getBundle, updateBundle } from './bundles';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    id: overrides.id ?? 'bundle-1',
    name: overrides.name ?? 'Day X',
    memberIds: overrides.memberIds ?? ['t1', 't2', 't3'],
    createdAt: overrides.createdAt ?? 1,
  };
}

describe('bundles store', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetCorpusCache();
  });

  afterEach(() => {
    _resetCorpusCache();
  });

  it('round-trips a bundle, preserving member order', async () => {
    await addBundle(makeBundle({ memberIds: ['c', 'a', 'b'] }));
    const bundle = await getBundle('bundle-1');
    expect(bundle?.name).toBe('Day X');
    expect(bundle?.memberIds).toEqual(['c', 'a', 'b']);
  });

  it('rejects a duplicate id on add but allows update', async () => {
    await addBundle(makeBundle());
    await expect(addBundle(makeBundle())).rejects.toBeDefined();
    await updateBundle(makeBundle({ name: 'renamed', memberIds: ['t1'] }));
    const bundle = await getBundle('bundle-1');
    expect(bundle?.name).toBe('renamed');
    expect(bundle?.memberIds).toEqual(['t1']);
  });

  it('returns null for an unknown id (deleted-between-pick-and-generate)', async () => {
    expect(await getBundle('nope')).toBeNull();
  });

  it('deletes by id and lists the rest', async () => {
    await addBundle(makeBundle({ id: 'a' }));
    await addBundle(makeBundle({ id: 'b' }));
    await deleteBundle('a');
    const all = await getAllBundles();
    expect(all.map((b) => b.id)).toEqual(['b']);
  });
});
