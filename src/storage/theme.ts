/**
 * Theme preference — 'auto' | 'light' | 'dim' | 'lights' (the X-native
 * reskin's three explicit themes plus follow-the-OS).
 *
 * Stored in `chrome.storage.local` (never `.sync` per §6) under
 * `themePreference:v1`. Default is 'auto': follow `prefers-color-scheme`,
 * with dark resolving to Dim (X's own default dark variant). The
 * pre-reskin binary 'dark' value reads as 'dim' — read-side mapping
 * only, the stored value is never rewritten in place.
 *
 * Callers should subscribe to `subscribeTheme` to get live updates.
 */
const FIELD = 'themePreference:v1';

export type ThemePreference = 'auto' | 'light' | 'dim' | 'lights';
/** What actually lands on <html data-theme> — 'auto' resolved. */
export type ResolvedTheme = 'light' | 'dim' | 'lights';

type Unsubscribe = () => void;

function normalizePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'dim' || value === 'lights') return value;
  if (value === 'dark') return 'dim'; // pre-reskin binary value
  return 'auto';
}

export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await chrome.storage.local.get(FIELD);
  return normalizePreference(raw[FIELD]);
}

export async function setThemePreference(value: ThemePreference): Promise<void> {
  await chrome.storage.local.set({ [FIELD]: value });
}

/** Resolve 'auto' against the OS scheme (dark → Dim). */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'auto') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dim' : 'light';
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
    listener(normalizePreference(change.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Convenience for entrypoints: bind the RESOLVED theme to the
 * `data-theme` attribute on `document.documentElement`, re-resolving
 * when the OS scheme flips while the preference is 'auto'. Returns an
 * unsubscribe.
 */
export function bindDocumentTheme(): Unsubscribe {
  let current: ThemePreference = 'auto';
  const apply = (): void => {
    document.documentElement.setAttribute('data-theme', resolveTheme(current));
  };
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMediaChange = (): void => {
    if (current === 'auto') apply();
  };
  media.addEventListener('change', onMediaChange);
  const unsub = subscribeTheme((pref) => {
    current = pref;
    apply();
  });
  return () => {
    unsub();
    media.removeEventListener('change', onMediaChange);
  };
}
