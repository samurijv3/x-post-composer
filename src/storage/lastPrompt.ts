/**
 * Last assembled prompt + Anthropic response, kept for the "Inspect
 * last prompt" view in the Prompts tab. Stored in
 * `chrome.storage.session` (ephemeral by design — drafts and parent
 * tweets are personal and shouldn't survive a browser quit).
 *
 * The record is written ONLY in the background worker (the sole place
 * the call happens). The Prompts tab reads it back and subscribes for
 * live updates.
 */
const FIELD = 'lastPrompt:v1';

export interface LastPromptRecord {
  /** Epoch ms at the moment the call returned. */
  timestamp: number;
  mode: 'post' | 'reply';
  /** Final prompt body as sent to Anthropic. */
  prompt: string;
  /** Raw text content returned. May be the post-repair version. */
  response: string;
  /** True when a repair re-prompt fired. */
  wasRepaired: boolean;
  /** Pretty-print summary of what the repair pass targeted, when fired. */
  repairContext?: string;
}

type Unsubscribe = () => void;

export async function getLastPrompt(): Promise<LastPromptRecord | null> {
  const raw = await chrome.storage.session.get(FIELD);
  const value = raw[FIELD] as LastPromptRecord | undefined;
  return value ?? null;
}

export async function setLastPrompt(record: LastPromptRecord): Promise<void> {
  await chrome.storage.session.set({ [FIELD]: record });
}

export function subscribeLastPrompt(listener: (r: LastPromptRecord | null) => void): Unsubscribe {
  void getLastPrompt().then(listener);
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if (area !== 'session') return;
    const change = changes[FIELD];
    if (!change) return;
    listener((change.newValue as LastPromptRecord | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
