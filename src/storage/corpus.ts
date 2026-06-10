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
 *   v2: adds `authorDisplayName` and `authorAvatarUrl` (both string | null)
 *       to LibraryItem for X-native rendering. The upgrade backfills both
 *       fields to null on existing rows so all reads see the v2 shape.
 */
import type { LibraryItem } from '../types';

export const DB_NAME = 'x-post-composer';
export const DB_VERSION = 2;
/**
 * Version stamped into library-export JSON. Tracks the LibraryItem ROW
 * shape, which is defined by the DB schema version — bump alongside
 * DB_VERSION whenever a migration changes the row shape, so a future
 * import can tell what it is reading.
 */
export const EXPORT_SCHEMA_VERSION = DB_VERSION;
export const STORE_ITEMS = 'items';
// Schema-level seam: no v1 reader queries this index (sampling filters
// in memory), but Phase-2 retrieval will, and indexes are cheapest to
// carry from day one rather than added via migration later.
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
      if (oldVersion < 2) {
        // Backfill v2 fields on rows captured before display name and
        // avatar URL existed. Runs inside the versionchange transaction
        // so it completes before any read sees the new schema.
        const tx = request.transaction;
        if (tx) {
          const store = tx.objectStore(STORE_ITEMS);
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const row = cursor.value as Partial<LibraryItem>;
            let changed = false;
            if (row.authorDisplayName === undefined) {
              row.authorDisplayName = null;
              changed = true;
            }
            if (row.authorAvatarUrl === undefined) {
              row.authorAvatarUrl = null;
              changed = true;
            }
            if (changed) cursor.update(row);
            cursor.continue();
          };
        }
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

/** Remove every item in one transaction — all-or-nothing, unlike a
 *  per-item delete loop that can fail half-way through a large corpus. */
export async function clearAllItems(): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(txStore(db, 'readwrite').clear());
}

/** Read every item. Order is unspecified. */
export async function getAllItems(): Promise<LibraryItem[]> {
  const db = await openCorpus();
  const result = await promisifyRequest(txStore(db, 'readonly').getAll());
  return result as LibraryItem[];
}

/** Total number of items in the corpus. */
export async function countItems(): Promise<number> {
  const db = await openCorpus();
  return promisifyRequest(txStore(db, 'readonly').count());
}
