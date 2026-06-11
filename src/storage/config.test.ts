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

  it('supplies the noAiColon default (off) for installs saved before the rule existed', async () => {
    seed({ structuralRules: { noEmDash: true, noSmartQuotes: true, noStaccato: true } });
    const s = await getSettings();
    expect(s.structuralRules.noAiColon).toBe(false);
  });

  it('keeps a deliberately-emptied banlist empty (no silent re-defaulting)', async () => {
    seed({ doNotSay: [] });
    const s = await getSettings();
    expect(s.doNotSay).toEqual([]);
  });

  describe('promptTemplates migration', () => {
    it('resets a legacy v1 single-body template to the new default (customised or not)', async () => {
      // v1 stored one `body` string with a ===USER=== marker; that shape
      // has no faithful mapping onto {system, user}, so it resets —
      // recorded in roadmap.md Build Decisions Log (Phase 1 build).
      seed({
        promptTemplates: {
          reply: { name: 'Reply', body: 'my customised v1 body {{bullets}}', slots: ['bullets'] },
        },
      });
      const s = await getSettings();
      expect(s.promptTemplates.reply).toEqual(DEFAULT_SETTINGS.promptTemplates.reply);
    });

    it('drops legacy v1 keys (repair/chipRefine/moreLessRefine/tighten) entirely', async () => {
      seed({
        promptTemplates: {
          chipRefine: { name: 'Chip refine', body: 'old chip body', slots: [] },
          tighten: { name: 'Tighten', body: 'old tighten body', slots: [] },
        },
      });
      const s = await getSettings();
      expect(Object.keys(s.promptTemplates).sort()).toEqual(['post', 'refine', 'reply']);
      expect(s.promptTemplates).toEqual(DEFAULT_SETTINGS.promptTemplates);
    });

    it('restores the default when the stored system body is blank', async () => {
      seed({
        promptTemplates: { reply: { name: 'Reply', system: '', user: 'custom user', slots: [] } },
      });
      const s = await getSettings();
      expect(s.promptTemplates.reply).toEqual(DEFAULT_SETTINGS.promptTemplates.reply);
    });

    it('restores the default when the stored user body is blank (whitespace counts)', async () => {
      seed({
        promptTemplates: {
          post: { name: 'Post', system: 'custom system', user: '   \n  ', slots: [] },
        },
      });
      const s = await getSettings();
      expect(s.promptTemplates.post).toEqual(DEFAULT_SETTINGS.promptTemplates.post);
    });

    it('preserves a customised system/user pair verbatim', async () => {
      seed({
        promptTemplates: {
          refine: {
            name: 'Refine',
            system: 'My custom refine system {{styleGuide}}',
            user: 'My custom refine user {{draft}} {{instruction}}',
            slots: ['styleGuide', 'draft', 'instruction'],
          },
        },
      });
      const s = await getSettings();
      expect(s.promptTemplates.refine.system).toBe('My custom refine system {{styleGuide}}');
      expect(s.promptTemplates.refine.user).toBe('My custom refine user {{draft}} {{instruction}}');
    });

    it('fills missing name/slots on a customised template from the default', async () => {
      seed({ promptTemplates: { post: { name: '', system: 'custom sys', user: 'custom user' } } });
      const s = await getSettings();
      expect(s.promptTemplates.post.name).toBe(DEFAULT_SETTINGS.promptTemplates.post.name);
      expect(s.promptTemplates.post.slots).toEqual(DEFAULT_SETTINGS.promptTemplates.post.slots);
      expect(s.promptTemplates.post.system).toBe('custom sys');
      expect(s.promptTemplates.post.user).toBe('custom user');
    });

    it('untouched templates fall back to defaults; unknown keys are dropped', async () => {
      seed({ promptTemplates: { bogus: { name: 'x', system: 'y', user: 'z', slots: [] } } });
      const s = await getSettings();
      expect(Object.keys(s.promptTemplates).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS.promptTemplates).sort(),
      );
      expect(s.promptTemplates.reply).toEqual(DEFAULT_SETTINGS.promptTemplates.reply);
    });
  });
});

describe('default-chip seeding (one-time, idempotent)', () => {
  const PRE_SEED_CHIPS = [
    { id: 'shorter', label: 'Shorter', instruction: 'Make it noticeably shorter.' },
    { id: 'warmer', label: 'Warmer', instruction: 'Make the tone warmer and more human.' },
    { id: 'punchier', label: 'Punchier', instruction: 'Make it punchier and more direct.' },
  ];

  it("seeds 'longer' into a pre-tracking install, right after 'shorter'", async () => {
    seed({ chips: PRE_SEED_CHIPS }); // no seededChipIds stored — old install
    const s = await getSettings();
    expect(s.chips.map((c) => c.id)).toEqual(['shorter', 'longer', 'warmer', 'punchier']);
    expect(s.seededChipIds).toContain('longer');
  });

  it('never resurrects a seeded chip the user deleted', async () => {
    seed({
      chips: PRE_SEED_CHIPS, // user removed 'longer' after it was seeded
      seededChipIds: ['shorter', 'longer', 'warmer', 'punchier'],
    });
    const s = await getSettings();
    expect(s.chips.map((c) => c.id)).toEqual(['shorter', 'warmer', 'punchier']);
  });

  it('preserves custom chips and appends a seed when its predecessor is gone', async () => {
    seed({
      chips: [{ id: 'mine', label: 'Mine', instruction: 'Do my thing.' }],
      seededChipIds: ['shorter', 'warmer', 'punchier'],
    });
    const s = await getSettings();
    expect(s.chips[0]?.id).toBe('mine'); // custom chip untouched, first
    expect(s.chips.map((c) => c.id)).toContain('longer'); // seeded (appended)
  });

  it('a fresh install just gets the defaults', async () => {
    const s = await getSettings();
    expect(s.chips).toEqual(DEFAULT_SETTINGS.chips);
    expect(s.seededChipIds).toEqual(DEFAULT_SETTINGS.chips.map((c) => c.id));
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
