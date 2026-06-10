/**
 * One-shot flag the keyboard shortcut sets just before opening the
 * panel: "capture reply context as soon as you're up."
 *
 * Session-scoped and consumed on read. The background stamps the flag
 * AND the companion `bg:auto-reply-capture` broadcast with the same
 * timestamp so the panel can dedupe the pair (a freshly-opened panel
 * sees both) and ignore stale flags left by a closed panel.
 */
const FIELD = 'autoReplyCapture:v1';

export async function setAutoReplyFlag(at: number): Promise<void> {
  await chrome.storage.session.set({ [FIELD]: at });
}

/** Read AND clear the flag. Returns the stamp, or null when unset. */
export async function consumeAutoReplyFlag(): Promise<number | null> {
  const raw = await chrome.storage.session.get(FIELD);
  const at = raw[FIELD];
  await chrome.storage.session.remove(FIELD);
  return typeof at === 'number' ? at : null;
}
