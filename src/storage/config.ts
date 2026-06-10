/**
 * Typed config store backed by `chrome.storage.local`.
 *
 * Why `local` and never `sync`: `chrome.storage.sync` pushes data to
 * Google's servers and across the user's devices, which would leak
 * settings (and risk leaking the API key if it ever lived here). See
 * CLAUDE.md §6.
 *
 * The API key is NOT stored through this module; see `./key.ts`.
 */
import {
  DEFAULT_SETTINGS,
  type PromptTemplate,
  type PromptTemplateKey,
  type Settings,
} from '../types';

const SETTINGS_KEY = 'settings:v1';

type Unsubscribe = () => void;

/**
 * Read the current settings, falling back to defaults for any missing
 * field so older installs roll forward cleanly.
 */
export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  return mergeWithDefaults(stored);
}

/**
 * Persist a partial update. Unspecified fields keep their current value.
 */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}

/**
 * Subscribe to settings changes. The callback fires whenever the stored
 * settings record is written to. Returns a function that unsubscribes.
 */
export function subscribeSettings(listener: (next: Settings) => void): Unsubscribe {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    const next = mergeWithDefaults(change.newValue as Partial<Settings> | undefined);
    listener(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

function mergeWithDefaults(stored: Partial<Settings> | undefined): Settings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    temperature: { ...DEFAULT_SETTINGS.temperature, ...(stored.temperature ?? {}) },
    structuralRules: {
      ...DEFAULT_SETTINGS.structuralRules,
      ...(stored.structuralRules ?? {}),
    },
    promptTemplates: mergePromptTemplates(stored.promptTemplates),
  };
}

/**
 * Per-template merge with an empty-body migration.
 *
 * Chunk 1 seeded `promptTemplates` with placeholder entries whose
 * `body` was `''`. Any user who first installed before Chunk 3 has
 * those empties in `chrome.storage.local`, and a naive object spread
 * would keep them — leading to an empty `messages.0.content` and a
 * 400 from Anthropic. Treat an empty body as "never customised" and
 * fall back to the current default for that template. A genuinely
 * customised body (anything non-empty) is preserved verbatim.
 */
function mergePromptTemplates(
  stored: Partial<Record<PromptTemplateKey, PromptTemplate>> | undefined,
): Settings['promptTemplates'] {
  const keys = Object.keys(DEFAULT_SETTINGS.promptTemplates) as PromptTemplateKey[];
  const out = { ...DEFAULT_SETTINGS.promptTemplates };
  if (!stored) return out;
  for (const key of keys) {
    const storedTemplate = stored[key];
    if (!storedTemplate) continue;
    const dflt = DEFAULT_SETTINGS.promptTemplates[key];
    const body = storedTemplate.body?.trim() ?? '';
    if (body === '') {
      // Stale Chunk-1 placeholder, or the user accidentally blanked it.
      // Either way an empty prompt is a guaranteed 400 — restore default.
      out[key] = dflt;
      continue;
    }
    out[key] = {
      name: storedTemplate.name || dflt.name,
      body: storedTemplate.body,
      slots: storedTemplate.slots ?? dflt.slots,
    };
  }
  return out;
}
