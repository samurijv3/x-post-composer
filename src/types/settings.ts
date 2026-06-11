/**
 * User-editable settings.
 *
 * Note on the API key: the key is conceptually a setting, but it is NOT a
 * field on this type. The key has its own storage abstraction
 * (see `src/storage/key.ts`) because it must never sit in normal Settings
 * state in the panel and because it can live in either local or session
 * storage based on `keyStorageMode`. Keeping it off this type makes the
 * boundary impossible to cross by accident — see CLAUDE.md §6.
 */
// Runtime import is safe: lib/prompt/defaults has only type-only imports
// back into types/, so there is no runtime cycle.
import { DEFAULT_PROMPT_TEMPLATES } from '../lib/prompt/defaults';

export interface Settings {
  /** The user's X handle without the leading `@`. Used as the hard filter
   *  when capturing tweets — only the user's own writing enters the library. */
  handle: string;

  /** Where the API key lives. `local` survives full browser quits;
   *  `session` is cleared then. */
  keyStorageMode: 'local' | 'session';

  /** Anthropic model id used for generation. Shown read-only in the
   *  Account section; a picker is planned. When the picker lands, gate
   *  the `temperature` parameter by model family — newer Opus models
   *  (4.7+) reject sampling parameters with a 400. */
  model: string;

  /** Default position of the ≤280 character toggle in the panel. */
  charCapDefault: boolean;

  /** Per-post guardrail when the ≤280 toggle is off. */
  softCapChars: number;

  /** How many library items the prompt builder is allowed to consider. */
  poolSize: number;

  /** How many starred items ride on top of the sampled pool, guaranteed
   *  in every prompt (Core Concept A). Capped in the sampler at
   *  floor(poolSize / 2) so the canon can't drown out range. */
  starCount: number;

  /** Curated ('manual'+'shipped') share of the sampled pool, 0..1.
   *  Archive tops up the remainder. Inert until archive items exist
   *  (Phase 7 activates the slider). */
  curatedArchiveBalance: number;

  /** Free-text guidance always injected into the prompt. */
  styleGuide: string;

  /** Sampling temperatures for first draft vs. regeneration. */
  temperature: { generate: number; regenerate: number };

  /** Toggles for the deterministic exclusion detectors. */
  structuralRules: {
    noStaccato: boolean;
    noEmDash: boolean;
    noSmartQuotes: boolean;
    /** The label-colon construction ("The result: …"). DEFAULT OFF and
     *  deliberately narrow — colons are common in legitimate writing;
     *  times, ratios, and list lead-ins are never flagged. */
    noAiColon: boolean;
  };

  /** Whole-word banlist enforced by the do-not-say matcher. */
  doNotSay: string[];

  /** Chip presets shown above the refine box. */
  chips: ChipPreset[];

  /** Ids of default chips this install has already been offered. Lets a
   *  NEW default chip seed into an existing install exactly once — and
   *  makes deleting a seeded chip permanent (no zombie re-seeding on
   *  every read). Maintained by the settings merge. */
  seededChipIds: string[];

  /** The Phase 4 corpus loop: save committed (copied-to-X) drafts to
   *  the library as `source: 'shipped'` examples. Default ON; the panel
   *  offers a per-draft opt-out next to Copy. */
  saveShippedDrafts: boolean;

  /** Editable prompt templates with named slots. The default bodies
   *  live in lib/prompt/defaults.ts (the single source of truth). */
  promptTemplates: Record<PromptTemplateKey, PromptTemplate>;
}

export interface ChipPreset {
  id: string;
  label: string;
  /** Instruction text appended to the refine prompt when the chip fires. */
  instruction: string;
}

export type PromptTemplateKey = 'reply' | 'post' | 'refine';

export interface PromptTemplate {
  /** Human-readable name shown in the Prompts tab. */
  name: string;
  /** System-message body with `{{slot}}` placeholders — the invariant
   *  framing (role, precedence, style guide, exclusions) that does not
   *  change between two consecutive calls. */
  system: string;
  /** User-message body with `{{slot}}` placeholders — the per-call
   *  content (examples, reply context, length, intent / draft +
   *  instruction). */
  user: string;
  /** Slots the template advertises, across both bodies. Validated at
   *  assembly time. */
  slots: string[];
}

// Pinned dated snapshot (reproducible behavior) rather than the
// `claude-haiku-4-5` alias. Verified current against docs.claude.com
// 2026-06; re-verify there when changing, per CLAUDE.md §2.
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const DEFAULT_CHIPS: ChipPreset[] = [
  { id: 'shorter', label: 'Shorter', instruction: 'Make it noticeably shorter.' },
  {
    id: 'longer',
    label: 'Longer',
    instruction: 'Make it noticeably longer — develop the idea a step further.',
  },
  { id: 'warmer', label: 'Warmer', instruction: 'Make the tone warmer and more human.' },
  { id: 'punchier', label: 'Punchier', instruction: 'Make it punchier and more direct.' },
];

export const DEFAULT_SETTINGS: Settings = {
  handle: '',
  keyStorageMode: 'local',
  model: DEFAULT_MODEL,
  charCapDefault: true,
  softCapChars: 1000,
  poolSize: 20,
  starCount: 4,
  curatedArchiveBalance: 0.7,
  styleGuide: '',
  temperature: { generate: 0.7, regenerate: 0.9 },
  structuralRules: {
    noStaccato: true,
    noEmDash: true,
    noSmartQuotes: true,
    // Off by default: narrow as it is, colon style is too personal to
    // police unasked (roadmap Phase 3).
    noAiColon: false,
  },
  // Small starter set of common AI-isms. Users can edit freely in the
  // options page's Output rules section.
  doNotSay: [
    'delve',
    'tapestry',
    'navigate the complexities',
    "it's worth noting",
    'in the realm of',
    'dive in',
    'as an AI',
    'in conclusion',
  ],
  chips: DEFAULT_CHIPS,
  seededChipIds: DEFAULT_CHIPS.map((c) => c.id),
  saveShippedDrafts: true,
  // The bodies live in lib/prompt/defaults.ts — the one place default
  // prompt text is defined (see ARCH-01 in AUDIT.md).
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
};
