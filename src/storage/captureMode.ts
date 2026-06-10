/**
 * Active capture mode — drives both the library-capture click behavior
 * and the reply-context selection flow. Stored in
 * `chrome.storage.session` so the value vanishes on full browser quit
 * by design.
 *
 * Mutual exclusion is enforced by representation: there is exactly one
 * value at any moment, so the panel cannot accidentally enable both
 * modes at once and content-script behavior is unambiguous on each
 * click. The two toggles (CaptureControls + Composer reply toggle)
 * both read and write this same field.
 *
 * Content scripts cannot read `chrome.storage.session` directly (kept
 * trusted-only so the user's "Session only" API-key choice keeps its
 * isolation). They get the value via messaging — see
 * `content:check-capture-mode` and the `bg:capture-mode-state` push.
 */
export type ActiveCaptureMode = 'none' | 'library' | 'reply-context';

const FIELD = 'activeCaptureMode:v1';
type Unsubscribe = () => void;

/** Read the current capture-mode value. Defaults to 'none'. */
export async function getCaptureMode(): Promise<ActiveCaptureMode> {
  const raw = await chrome.storage.session.get(FIELD);
  const value = raw[FIELD];
  if (value === 'library' || value === 'reply-context') return value;
  return 'none';
}

/** Persist the capture-mode value. Passing 'none' clears it. */
export async function setCaptureMode(value: ActiveCaptureMode): Promise<void> {
  if (value === 'none') {
    await chrome.storage.session.remove(FIELD);
    return;
  }
  await chrome.storage.session.set({ [FIELD]: value });
}

/**
 * Watch for changes. Fires immediately with the current value on
 * subscription so callers don't need a separate initial read.
 */
export function subscribeCaptureMode(listener: (value: ActiveCaptureMode) => void): Unsubscribe {
  void getCaptureMode().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'session') return;
    const change = changes[FIELD];
    if (!change) return;
    const next = change.newValue;
    if (next === 'library' || next === 'reply-context') listener(next);
    else listener('none');
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
