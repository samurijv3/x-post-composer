/**
 * Versioned IndexedDB store for the writing corpus.
 *
 * The store is versioned from day one so adding fields (or whole stores)
 * later does not need a refactor — see CLAUDE.md §7 and §8.
 *
 * Schema versions
 *   v1: object store `items` keyed by `id`, with index `byType` on `type`.
 *       Fields match the v1 LibraryItem shape including the always-null
 *       `embedding` field reserved for later semantic retrieval.
 */
import type { LibraryItem } from '../types';

export const DB_NAME = 'x-post-composer';
export const DB_VERSION = 1;
export const STORE_ITEMS = 'items';
const INDEX_BY_TYPE = 'byType';

let cachedDb: IDBDatabase | null = null;

/**
 * Open (or upgrade) the corpus database. Subsequent calls reuse the
 * connection. Each schema bump should add a new `if (oldVersion < N)`
 * block to the upgrade handler — never edit an existing one.
 */
export function openCorpus(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        store.createIndex(INDEX_BY_TYPE, 'type', { unique: false });
      }
    };
    request.onsuccess = () => {
      cachedDb = request.result;
      resolve(cachedDb);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

/** For tests: drop the cached connection so a fresh `indexedDB` is observed. */
export function _resetCorpusCache(): void {
  cachedDb?.close();
  cachedDb = null;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_ITEMS, mode).objectStore(STORE_ITEMS);
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Insert a new item. Rejects if `item.id` is already present. */
export async function addItem(item: LibraryItem): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(txStore(db, 'readwrite').add(item));
}

/** Insert or overwrite an item by id. */
export async function updateItem(item: LibraryItem): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(txStore(db, 'readwrite').put(item));
}

/** Remove the item with the given id. No-op if it does not exist. */
export async function deleteItem(id: string): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(txStore(db, 'readwrite').delete(id));
}

/** Read every item. Order is unspecified. */
export async function getAllItems(): Promise<LibraryItem[]> {
  const db = await openCorpus();
  const result = await promisifyRequest(txStore(db, 'readonly').getAll());
  return result as LibraryItem[];
}

/** Read every item of the requested type. */
export async function getItemsByType(type: LibraryItem['type']): Promise<LibraryItem[]> {
  const db = await openCorpus();
  const store = txStore(db, 'readonly');
  const index = store.index(INDEX_BY_TYPE);
  const result = await promisifyRequest(index.getAll(type));
  return result as LibraryItem[];
}

/** Total number of items in the corpus. */
export async function countItems(): Promise<number> {
  const db = await openCorpus();
  return promisifyRequest(txStore(db, 'readonly').count());
}
