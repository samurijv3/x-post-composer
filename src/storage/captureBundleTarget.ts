/**
 * The optional bundle target for library capture mode (Phase 6): while
 * set, tweets captured (or pasted) into the library also file into
 * this bundle — one gesture builds a series from existing tweets on X.
 *
 * Lifetime: WHILE A PANEL IS OPEN. The target deliberately survives
 * mode toggles — browsing for examples means flipping capture off/on
 * repeatedly, and the bundle choice should hold — but the background
 * clears it when the last panel closes, so a fresh panel always starts
 * filing into plain library. Session storage underneath (browser quit
 * also clears, as a backstop). The value is a bundle id; the
 * background validates it still exists at capture time and skips
 * filing silently when it doesn't (eligibility, not error).
 */
const FIELD = 'captureBundleTarget:v1';

type Unsubscribe = () => void;

export async function getCaptureBundleTarget(): Promise<string | null> {
  const raw = await chrome.storage.session.get(FIELD);
  const value = raw[FIELD] as string | undefined;
  return value ?? null;
}

export async function setCaptureBundleTarget(bundleId: string | null): Promise<void> {
  if (bundleId === null) {
    await chrome.storage.session.remove(FIELD);
  } else {
    await chrome.storage.session.set({ [FIELD]: bundleId });
  }
}

export function subscribeCaptureBundleTarget(
  listener: (bundleId: string | null) => void,
): Unsubscribe {
  void getCaptureBundleTarget().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if (area !== 'session') return;
    const change = changes[FIELD];
    if (!change) return;
    listener((change.newValue as string | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
