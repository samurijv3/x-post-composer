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
 *   v3: collapses the source taxonomy to Core Concept A — 'capture'
 *       becomes 'manual' (both are handpicks), 'import' becomes
 *       'archive'; 'shipped' is introduced for the Phase 4 corpus loop
 *       (no existing rows carry it, so no backfill for it).
 *   v4: adds `favorite: boolean` (the Star tier), backfilled false on
 *       existing rows.
 */
import type { LibraryItem } from '../types';

export const DB_NAME = 'x-post-composer';
export const DB_VERSION = 4;
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
 * connection. Each schema bump adds a new migration-pass FUNCTION and
 * registers it for `oldVersion < N` — never edit an existing pass.
 * Passes are scheduled sequentially (see the comment in the upgrade
 * handler for why concurrency corrupts rows).
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
      // Row-rewriting passes run SEQUENTIALLY, one per schema version,
      // each keeping its original logic verbatim in its own function.
      // They cannot run concurrently: two open cursors interleave row
      // by row, and `cursor.update` writes the FULL row that cursor
      // read — the later pass's stale read silently erases the earlier
      // pass's fields (found when v3 joined v2 on v1 databases). All
      // passes still complete inside the versionchange transaction, so
      // no read ever sees a half-migrated store.
      const tx = request.transaction;
      if (!tx) return;
      const passes: MigrationPass[] = [];
      if (oldVersion < 2) passes.push(backfillDisplayFieldsV2);
      if (oldVersion < 3) passes.push(collapseSourceTaxonomyV3);
      if (oldVersion < 4) passes.push(backfillFavoriteV4);
      let passIndex = 0;
      const runNextPass = (): void => {
        const pass = passes[passIndex++];
        if (!pass) return;
        pass(tx.objectStore(STORE_ITEMS), runNextPass);
      };
      runNextPass();
    };
    request.onsuccess = () => {
      cachedDb = request.result;
      resolve(cachedDb);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

type MigrationPass = (store: IDBObjectStore, done: () => void) => void;

/** v2 pass: backfill `authorDisplayName` / `authorAvatarUrl` as null on
 *  rows captured before X-native rendering existed. */
function backfillDisplayFieldsV2(store: IDBObjectStore, done: () => void): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) {
      done();
      return;
    }
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

/** v3 pass: source-taxonomy collapse (roadmap Core Concept A) —
 *  'capture' and 'manual' merge into 'manual' (both are handpicks);
 *  'import' is renamed 'archive'. 'shipped' is new, so nothing
 *  migrates onto it. */
function collapseSourceTaxonomyV3(store: IDBObjectStore, done: () => void): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) {
      done();
      return;
    }
    const row = cursor.value as { source?: string };
    if (row.source === 'capture') {
      row.source = 'manual';
      cursor.update(row);
    } else if (row.source === 'import') {
      row.source = 'archive';
      cursor.update(row);
    }
    cursor.continue();
  };
}

/** v4 pass: backfill `favorite: false` (the Star tier) on rows stored
 *  before stars existed. */
function backfillFavoriteV4(store: IDBObjectStore, done: () => void): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) {
      done();
      return;
    }
    const row = cursor.value as Partial<LibraryItem>;
    if (row.favorite === undefined) {
      row.favorite = false;
      cursor.update(row);
    }
    cursor.continue();
  };
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
