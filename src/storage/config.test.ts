import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { getSettings, setSettings } from './config';

/**
 * The merge + template-migration logic in config.ts decides whether a
 * user's saved settings survive an upgrade — load-bearing enough to pin
 * (AUDIT.md TEST-01). chrome.storage.local is stubbed with an in-memory
 * record; tests drive the public getSettings/setSettings surface.
 */
const SETTINGS_KEY = 'settings:v1';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
        set: vi.fn((obj: Record<string, unknown>) => {
          Object.assign(store, obj);
          return Promise.resolve();
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seed(stored: unknown): void {
  store[SETTINGS_KEY] = stored;
}

describe('getSettings', () => {
  it('returns full defaults when nothing is stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial record over defaults', async () => {
    seed({ handle: 'sam', poolSize: 7 });
    const s = await getSettings();
    expect(s.handle).toBe('sam');
    expect(s.poolSize).toBe(7);
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
    expect(s.chips).toEqual(DEFAULT_SETTINGS.chips);
  });

  it('merges nested temperature per-field (old installs missing a field roll forward)', async () => {
    seed({ temperature: { generate: 0.5 } });
    const s = await getSettings();
    expect(s.temperature.generate).toBe(0.5);
    expect(s.temperature.regenerate).toBe(DEFAULT_SETTINGS.temperature.regenerate);
  });

  it('merges nested structuralRules per-field', async () => {
    seed({ structuralRules: { noEmDash: false } });
    const s = await getSettings();
    expect(s.structuralRules.noEmDash).toBe(false);
    expect(s.structuralRules.noSmartQuotes).toBe(true);
    expect(s.structuralRules.noStaccato).toBe(true);
  });

  it('keeps a deliberately-emptied banlist empty (no silent re-defaulting)', async () => {
    seed({ doNotSay: [] });
    const s = await getSettings();
    expect(s.doNotSay).toEqual([]);
  });

  describe('promptTemplates migration', () => {
    it('restores the default body when a stored template body is blank', async () => {
      seed({ promptTemplates: { reply: { name: 'Reply', body: '', slots: [] } } });
      const s = await getSettings();
      expect(s.promptTemplates.reply).toEqual(DEFAULT_SETTINGS.promptTemplates.reply);
    });

    it('treats whitespace-only bodies as blank too', async () => {
      seed({ promptTemplates: { post: { name: 'Post', body: '   \n  ', slots: [] } } });
      const s = await getSettings();
      expect(s.promptTemplates.post).toEqual(DEFAULT_SETTINGS.promptTemplates.post);
    });

    it('preserves a customised body verbatim', async () => {
      seed({
        promptTemplates: {
          tighten: {
            name: 'Tighten',
            body: 'My custom tighten prompt {{previousDraft}}',
            slots: ['previousDraft'],
          },
        },
      });
      const s = await getSettings();
      expect(s.promptTemplates.tighten.body).toBe('My custom tighten prompt {{previousDraft}}');
    });

    it('fills missing name/slots on a customised template from the default', async () => {
      seed({ promptTemplates: { repair: { name: '', body: 'custom {{violations}}' } } });
      const s = await getSettings();
      expect(s.promptTemplates.repair.name).toBe(DEFAULT_SETTINGS.promptTemplates.repair.name);
      expect(s.promptTemplates.repair.slots).toEqual(DEFAULT_SETTINGS.promptTemplates.repair.slots);
      expect(s.promptTemplates.repair.body).toBe('custom {{violations}}');
    });

    it('untouched templates fall back to defaults; unknown keys are dropped', async () => {
      seed({ promptTemplates: { bogus: { name: 'x', body: 'y', slots: [] } } });
      const s = await getSettings();
      expect(Object.keys(s.promptTemplates).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS.promptTemplates).sort(),
      );
      expect(s.promptTemplates.reply).toEqual(DEFAULT_SETTINGS.promptTemplates.reply);
    });
  });
});

describe('setSettings', () => {
  it('persists a patch merged over the current record', async () => {
    seed({ handle: 'old', poolSize: 11 });
    await setSettings({ handle: 'new' });
    const written = store[SETTINGS_KEY] as { handle: string; poolSize: number };
    expect(written.handle).toBe('new');
    expect(written.poolSize).toBe(11);
  });

  it('writes a complete settings record (defaults included) so reads never see holes', async () => {
    await setSettings({ styleGuide: 'dry, lowercase' });
    const written = store[SETTINGS_KEY] as Record<string, unknown>;
    expect(written.styleGuide).toBe('dry, lowercase');
    expect(written.model).toBe(DEFAULT_SETTINGS.model);
    expect(written.promptTemplates).toEqual(DEFAULT_SETTINGS.promptTemplates);
  });
});
