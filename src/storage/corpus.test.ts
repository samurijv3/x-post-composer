import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { LibraryItem } from '../types';
import {
  _resetCorpusCache,
  addItem,
  clearAllItems,
  countItems,
  DB_NAME,
  deleteItem,
  getAllItems,
  STORE_ITEMS,
  updateItem,
} from './corpus';

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: overrides.id ?? 'tweet-1',
    text: overrides.text ?? 'hello world',
    type: overrides.type ?? 'post',
    source: overrides.source ?? 'manual',
    authorHandle: overrides.authorHandle ?? 'me',
    authorDisplayName: overrides.authorDisplayName ?? null,
    authorAvatarUrl: overrides.authorAvatarUrl ?? null,
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00Z',
    engagement: overrides.engagement ?? null,
    embedding: overrides.embedding ?? null,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

describe('corpus store', () => {
  beforeEach(() => {
    // Reset both the global IndexedDB and the module's cached connection
    // so each test starts from a fully empty store.
    globalThis.indexedDB = new IDBFactory();
    _resetCorpusCache();
  });

  afterEach(() => {
    _resetCorpusCache();
  });

  it('round-trips a single item', async () => {
    await addItem(makeItem());
    const all = await getAllItems();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe('hello world');
  });

  it('rejects a duplicate id on add but allows update', async () => {
    await addItem(makeItem({ id: 'dup' }));
    await expect(addItem(makeItem({ id: 'dup' }))).rejects.toBeDefined();
    await updateItem(makeItem({ id: 'dup', text: 'new text' }));
    const all = await getAllItems();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe('new text');
  });

  it('deletes by id and counts correctly', async () => {
    await addItem(makeItem({ id: 'a' }));
    await addItem(makeItem({ id: 'b' }));
    expect(await countItems()).toBe(2);
    await deleteItem('a');
    expect(await countItems()).toBe(1);
    const remaining = await getAllItems();
    expect(remaining[0]?.id).toBe('b');
  });

  it('clears every item in one shot', async () => {
    await addItem(makeItem({ id: 'a' }));
    await addItem(makeItem({ id: 'b' }));
    await addItem(makeItem({ id: 'c' }));
    await clearAllItems();
    expect(await countItems()).toBe(0);
  });

  it('persists embedding as null in v1 records', async () => {
    await addItem(makeItem({ id: 'e1' }));
    const [item] = await getAllItems();
    expect(item?.embedding).toBeNull();
  });

  it('v1→v2 migration backfills authorDisplayName and authorAvatarUrl as null', async () => {
    // Seed a v1 database directly, inserting a row that lacks the v2
    // fields, then let openCorpus() trigger the upgrade on next read.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        store.createIndex('byType', 'type', { unique: false });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_ITEMS, 'readwrite');
        tx.objectStore(STORE_ITEMS).add({
          id: 'legacy-1',
          text: 'pre-migration',
          type: 'post',
          source: 'capture',
          authorHandle: 'me',
          timestamp: '2025-01-01T00:00:00Z',
          engagement: null,
          embedding: null,
          createdAt: 1,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('seed transaction failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('seed open failed'));
    });
    _resetCorpusCache();

    const items = await getAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.authorDisplayName).toBeNull();
    expect(items[0]?.authorAvatarUrl).toBeNull();
    // The same upgrade chain also runs v3: the v1 'capture' source
    // arrives as 'manual'.
    expect(items[0]?.source).toBe('manual');
  });

  it("v2→v3 migration collapses sources: 'capture'→'manual', 'import'→'archive'", async () => {
    // Seed a v2 database directly (v2 rows carry the display fields),
    // one row per legacy source value plus an already-correct one.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        store.createIndex('byType', 'type', { unique: false });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_ITEMS, 'readwrite');
        const base = {
          text: 'pre-migration',
          type: 'post',
          authorHandle: 'me',
          authorDisplayName: null,
          authorAvatarUrl: null,
          timestamp: '2025-01-01T00:00:00Z',
          engagement: null,
          embedding: null,
          createdAt: 1,
        };
        tx.objectStore(STORE_ITEMS).add({ ...base, id: 'was-capture', source: 'capture' });
        tx.objectStore(STORE_ITEMS).add({ ...base, id: 'was-import', source: 'import' });
        tx.objectStore(STORE_ITEMS).add({ ...base, id: 'was-manual', source: 'manual' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('seed transaction failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('seed open failed'));
    });
    _resetCorpusCache();

    const items = await getAllItems();
    const bySource = new Map(items.map((i) => [i.id, i.source]));
    expect(bySource.get('was-capture')).toBe('manual');
    expect(bySource.get('was-import')).toBe('archive');
    expect(bySource.get('was-manual')).toBe('manual');
  });
});
