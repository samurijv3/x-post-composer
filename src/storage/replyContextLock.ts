/**
 * The active reply-context lock — when the user has selected a tweet
 * (via click-to-select in reply-context mode), its `ReplyContext`
 * lives here and drives both the panel's reply-context display AND
 * the locked highlight overlay on the X page.
 *
 * Storage area is `chrome.storage.session` so the lock is per-browser-
 * session by default, matching the rest of our "stays on the user's
 * machine, evaporates on full quit" model. Cleared on dismiss, on
 * mode-off via Clear button, or programmatically when the user
 * navigates within X's SPA (handled by the content script reading the
 * URL and notifying us).
 *
 * Content scripts cannot read session storage directly. They get the
 * lock state via background pushes (`bg:reply-context-lock-state`)
 * and the initial-check request (`content:check-reply-context-lock`).
 */
import type { ReplyContext } from '../types';

const FIELD = 'replyContextLock:v1';
type Unsubscribe = () => void;

export async function getReplyContextLock(): Promise<ReplyContext | null> {
  const raw = await chrome.storage.session.get(FIELD);
  const value = raw[FIELD] as ReplyContext | undefined;
  return value ?? null;
}

export async function setReplyContextLock(value: ReplyContext | null): Promise<void> {
  if (value === null) {
    await chrome.storage.session.remove(FIELD);
    return;
  }
  await chrome.storage.session.set({ [FIELD]: value });
}

export function subscribeReplyContextLock(
  listener: (value: ReplyContext | null) => void,
): Unsubscribe {
  void getReplyContextLock().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'session') return;
    const change = changes[FIELD];
    if (!change) return;
    const next = (change.newValue as ReplyContext | undefined) ?? null;
    listener(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
