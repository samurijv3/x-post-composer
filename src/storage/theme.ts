/**
 * Theme preference — 'light' | 'dark' (binary).
 *
 * Stored in `chrome.storage.local` (never `.sync` per §6) under
 * `themePreference:v1`. Default is 'light'. The earlier System option
 * was dropped — cycling through three states felt awkward and the
 * user-facing concept "follow OS theme" is rarely worth the complexity.
 *
 * Callers should subscribe to `subscribeTheme` to get live updates.
 */
const FIELD = 'themePreference:v1';

export type ThemePreference = 'light' | 'dark';

type Unsubscribe = () => void;

export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await chrome.storage.local.get(FIELD);
  const value = raw[FIELD];
  return value === 'dark' ? 'dark' : 'light';
}

export async function setThemePreference(value: ThemePreference): Promise<void> {
  await chrome.storage.local.set({ [FIELD]: value });
}

/**
 * Listen for preference changes. Fires immediately with the current
 * value, then on every storage write. Returns an unsubscribe.
 */
export function subscribeTheme(listener: (theme: ThemePreference) => void): Unsubscribe {
  void getThemePreference().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if (area !== 'local') return;
    const change = changes[FIELD];
    if (!change) return;
    listener(change.newValue === 'dark' ? 'dark' : 'light');
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Convenience for entrypoints: bind the theme preference to a
 * `data-theme` attribute on `document.documentElement`. Returns an
 * unsubscribe.
 */
export function bindDocumentTheme(): Unsubscribe {
  return subscribeTheme((theme) => {
    document.documentElement.setAttribute('data-theme', theme);
  });
}
