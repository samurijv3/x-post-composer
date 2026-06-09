/**
 * API key storage abstraction.
 *
 * Why this is its own module: the key is the only piece of state with
 * meaningful blast radius (a leak costs API spend). Keeping it off the
 * normal Settings record means it cannot accidentally end up in panel
 * state, in a log line that dumps settings, or in an export file.
 *
 * Storage location is switchable so the user can opt for an in-memory
 * key that vanishes on full browser quit:
 *   - 'local'   → `chrome.storage.local`, persists across restarts.
 *   - 'session' → `chrome.storage.session`, cleared when the browser exits.
 *
 * Security invariants (CLAUDE.md §6):
 *   - The key is only ever read in the background service worker context.
 *     The settings UI writes via these helpers but never holds the value
 *     in React state beyond the input field for as long as the user is
 *     editing it.
 *   - The key is NEVER logged.
 */
const KEY_FIELD = 'apiKey:v1';

export type KeyStorageMode = 'local' | 'session';

function areaFor(mode: KeyStorageMode): chrome.storage.StorageArea {
  return mode === 'session' ? chrome.storage.session : chrome.storage.local;
}

/**
 * Read the API key from the area indicated by `mode`. Returns the empty
 * string when no key is set. The caller must not log or echo the value.
 */
export async function getApiKey(mode: KeyStorageMode): Promise<string> {
  const raw = await areaFor(mode).get(KEY_FIELD);
  const value = raw[KEY_FIELD];
  return typeof value === 'string' ? value : '';
}

/**
 * Persist the API key to the chosen storage area. Passing an empty string
 * removes it.
 */
export async function setApiKey(mode: KeyStorageMode, key: string): Promise<void> {
  if (key === '') {
    await areaFor(mode).remove(KEY_FIELD);
    return;
  }
  await areaFor(mode).set({ [KEY_FIELD]: key });
}

/**
 * Move an existing key from one storage area to another. Used when the
 * user flips the `keyStorageMode` setting. If no key is set in `from`,
 * this is a no-op.
 */
export async function migrateApiKey(from: KeyStorageMode, to: KeyStorageMode): Promise<void> {
  if (from === to) return;
  const existing = await getApiKey(from);
  if (existing === '') return;
  await setApiKey(to, existing);
  await areaFor(from).remove(KEY_FIELD);
}

/** Convenience: remove the key from both areas, e.g. on uninstall flows. */
export async function clearApiKey(): Promise<void> {
  await chrome.storage.local.remove(KEY_FIELD);
  await chrome.storage.session.remove(KEY_FIELD);
}
