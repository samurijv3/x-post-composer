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
 *
 * Read-merge-write with no lock: two surfaces (panel + options page)
 * writing near-simultaneously would last-write-win on the whole record.
 * Acceptable because every settings field has exactly one writing
 * surface today — keep it that way, or move to per-field keys before
 * adding a second writer for any field.
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

/** What a stored template record may actually look like: the current
 *  two-body shape, or the legacy v1 single-`body` shape. */
type StoredPromptTemplate = Partial<PromptTemplate> & { body?: string };

/**
 * Per-template merge with two migrations folded in:
 *
 * 1. **v1 single-body → v2 system/user reset.** Templates used to be one
 *    `body` string with a `===USER===` marker; they are now an explicit
 *    `{system, user}` pair with different slot names. An old customised
 *    body has no faithful mapping onto the new shape, so any record
 *    without both new fields RESETS to the current default — customised
 *    v1 bodies are deliberately dropped (recorded in roadmap.md Build
 *    Decisions Log, Phase 1 build). Old keys that no longer exist
 *    (repair, chipRefine, moreLessRefine, tighten) drop out naturally
 *    because we iterate the new key set.
 * 2. **Blanked-field restore.** An empty system or user body — a stale
 *    placeholder or an accidental blanking — would send a broken prompt,
 *    so either field being blank restores the whole default template. A
 *    genuinely customised pair (both fields non-empty) is preserved
 *    verbatim.
 */
function mergePromptTemplates(
  stored: Partial<Record<PromptTemplateKey, StoredPromptTemplate>> | undefined,
): Settings['promptTemplates'] {
  const keys = Object.keys(DEFAULT_SETTINGS.promptTemplates) as PromptTemplateKey[];
  const out = { ...DEFAULT_SETTINGS.promptTemplates };
  if (!stored) return out;
  for (const key of keys) {
    const storedTemplate = stored[key];
    if (!storedTemplate) continue;
    const dflt = DEFAULT_SETTINGS.promptTemplates[key];
    const system = typeof storedTemplate.system === 'string' ? storedTemplate.system : '';
    const user = typeof storedTemplate.user === 'string' ? storedTemplate.user : '';
    if (system.trim() === '' || user.trim() === '') {
      // Legacy v1 shape (no system/user at all) or a blanked field —
      // either way the stored record can't be sent as-is. Reset.
      out[key] = dflt;
      continue;
    }
    out[key] = {
      name: storedTemplate.name || dflt.name,
      system,
      user,
      slots: storedTemplate.slots ?? dflt.slots,
    };
  }
  return out;
}
