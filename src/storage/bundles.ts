/**
 * CRUD for context bundles (`Bundle` rows in the `bundles` object
 * store, schema v5). Same database as the corpus — `openCorpus` owns
 * versioning and migrations; this module only reads and writes rows.
 *
 * Bundles reference library items by id and tolerate dangling ids by
 * design (see the Bundle type). Nothing here resolves members — that
 * is `lib/bundles` `resolveBundleMembers`, so storage stays dumb.
 */
import type { Bundle } from '../types';
import { openCorpus, promisifyRequest, STORE_BUNDLES } from './corpus';

function bundleStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_BUNDLES, mode).objectStore(STORE_BUNDLES);
}

/** Insert a new bundle. Rejects if `bundle.id` is already present. */
export async function addBundle(bundle: Bundle): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(bundleStore(db, 'readwrite').add(bundle));
}

/** Insert or overwrite a bundle by id — covers rename, member removal,
 *  and auto-filing appends. */
export async function updateBundle(bundle: Bundle): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(bundleStore(db, 'readwrite').put(bundle));
}

/** Remove the bundle with the given id. No-op if it does not exist.
 *  Member items are untouched — a bundle only ever references them. */
export async function deleteBundle(id: string): Promise<void> {
  const db = await openCorpus();
  await promisifyRequest(bundleStore(db, 'readwrite').delete(id));
}

/** Read one bundle, or null when the id is unknown (e.g. deleted
 *  between being picked in the panel and generation running). */
export async function getBundle(id: string): Promise<Bundle | null> {
  const db = await openCorpus();
  // lib.dom types IDBObjectStore.get() as IDBRequest<any> — assert at
  // that boundary; this store only ever holds Bundle rows.
  const request = bundleStore(db, 'readonly').get(id) as IDBRequest<Bundle | undefined>;
  const result = await promisifyRequest(request);
  return result ?? null;
}

/** Read every bundle. Order is unspecified; callers sort. */
export async function getAllBundles(): Promise<Bundle[]> {
  const db = await openCorpus();
  const result = await promisifyRequest(bundleStore(db, 'readonly').getAll());
  return result as Bundle[];
}
