/**
 * Capture-mode flag, stored in `chrome.storage.session` so it is
 * ephemeral by design — turning capture on does not leak across a full
 * browser quit. Content scripts on X.com subscribe via
 * `chrome.storage.onChanged` and react in real time.
 */
const FIELD = 'captureMode:v1';
type Unsubscribe = () => void;

/** Read the current capture-mode flag. Defaults to false. */
export async function getCaptureMode(): Promise<boolean> {
  const raw = await chrome.storage.session.get(FIELD);
  return raw[FIELD] === true;
}

/** Persist the capture-mode flag. */
export async function setCaptureMode(value: boolean): Promise<void> {
  await chrome.storage.session.set({ [FIELD]: value });
}

/**
 * Watch for capture-mode changes. The listener fires immediately with
 * the current value on subscription so callers do not need a separate
 * initial read. Returns a function that unsubscribes.
 */
export function subscribeCaptureMode(listener: (value: boolean) => void): Unsubscribe {
  void getCaptureMode().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'session') return;
    const change = changes[FIELD];
    if (!change) return;
    listener(change.newValue === true);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
