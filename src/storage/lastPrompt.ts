/**
 * Last prompt chain + Anthropic response, kept for the "Inspect last
 * prompt" view in the panel. Stored in `chrome.storage.session`
 * (ephemeral by design — drafts and parent tweets are personal and
 * shouldn't survive a browser quit).
 *
 * The record is written ONLY in the background worker (the sole place
 * the call happens). The panel reads it back and subscribes for live
 * updates. Transparency is load-bearing (design.md): every call the
 * pipeline makes — generate/refine plus the optional repair and tighten
 * passes — appears here with the exact system and user text sent.
 *
 * Key history: `lastPrompt:v1` stored the chain as one joined string;
 * v2 stores structured per-call records. Old v1 records are simply
 * ignored (session storage evaporates on quit anyway).
 */
const FIELD = 'lastPrompt:v2';

/** One Anthropic call, exactly as sent. */
export interface PromptCall {
  /** What this call was for — 'generate', 'refine (…)', 'repair (…)',
   *  'tighten (…)'. Written by the pipeline, shown verbatim. */
  label: string;
  /** System message text. Empty string if the call had none. */
  system: string;
  /** User message text. */
  user: string;
}

export interface LastPromptRecord {
  /** Epoch ms at the moment the last call returned. */
  timestamp: number;
  mode: 'post' | 'reply';
  /** Every call in the invocation, in order (1–3 of them). */
  calls: PromptCall[];
  /** Raw text content of the final call. May be the post-repair version. */
  response: string;
  /** True when a repair or tighten re-prompt fired. */
  wasRepaired: boolean;
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
