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

  /** Anthropic model id used for generation. Becomes a dropdown later. */
  model: string;

  /** Default position of the ≤280 character toggle in the panel. */
  charCapDefault: boolean;

  /** Per-post guardrail when the ≤280 toggle is off. */
  softCapChars: number;

  /** How many library items the prompt builder is allowed to consider. */
  poolSize: number;

  /** Free-text guidance always injected into the prompt. */
  styleGuide: string;

  /** Sampling temperatures for first draft vs. regeneration. */
  temperature: { generate: number; regenerate: number };

  /** Toggles for the deterministic exclusion detectors. */
  structuralRules: {
    noStaccato: boolean;
    noEmDash: boolean;
    noSmartQuotes: boolean;
  };

  /** Whole-word banlist enforced by the do-not-say matcher. */
  doNotSay: string[];

  /** Chip presets shown above the refine box. */
  chips: ChipPreset[];

  /** Editable prompt templates with named slots. Real bodies arrive in
   *  Chunk 3; the shape lives here so the storage and settings UI can
   *  refer to it now. */
  promptTemplates: Record<PromptTemplateKey, PromptTemplate>;
}

export interface ChipPreset {
  id: string;
  label: string;
  /** Instruction text appended to the refine prompt when the chip fires. */
  instruction: string;
}

export type PromptTemplateKey =
  | 'reply'
  | 'post'
  | 'repair'
  | 'chipRefine'
  | 'moreLessRefine'
  | 'tighten';

export interface PromptTemplate {
  /** Human-readable name shown in the Prompts tab. */
  name: string;
  /** Template body with `{{slot}}` placeholders. */
  body: string;
  /** Slots the template advertises. Validated at assembly time. */
  slots: string[];
}

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const DEFAULT_SETTINGS: Settings = {
  handle: '',
  keyStorageMode: 'local',
  model: DEFAULT_MODEL,
  charCapDefault: true,
  softCapChars: 1000,
  poolSize: 20,
  styleGuide: '',
  temperature: { generate: 0.7, regenerate: 0.9 },
  structuralRules: {
    noStaccato: true,
    noEmDash: true,
    noSmartQuotes: true,
  },
  // Small starter set of common AI-isms. Users can edit freely in the
  // Output rules tab (lands in a later chunk).
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
  chips: [
    { id: 'shorter', label: 'Shorter', instruction: 'Make it noticeably shorter.' },
    { id: 'warmer', label: 'Warmer', instruction: 'Make the tone warmer and more human.' },
    { id: 'punchier', label: 'Punchier', instruction: 'Make it punchier and more direct.' },
  ],
  // The bodies live in lib/prompt/defaults.ts — the one place default
  // prompt text is defined (see ARCH-01 in AUDIT.md).
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
};
