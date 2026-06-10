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

  /** Percent of the example budget reserved for manually picked items.
   *  Inert in v1 (Phase 2 surfaces it once import lands). */
  manualCorpusBalance: number;

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

export type PromptTemplateKey = 'reply' | 'post' | 'repair' | 'chipRefine' | 'moreLessRefine' | 'tighten';

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
  manualCorpusBalance: 70,
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
  promptTemplates: {
    reply: {
      name: 'Reply',
      body: `You are writing a reply on X in the user's voice. Output ONLY the reply text — no preamble, no quotation marks around it, no commentary.

VOICE GUIDE
{{styleGuide}}

PATTERNS TO AVOID
{{exclusions}}

LENGTH
{{charConstraint}}
===USER===
EXAMPLES OF THE USER'S OWN REPLIES (sample these for tone and rhythm, not topic)
{{examples}}

THE TWEET BEING REPLIED TO (by someone else)
{{targetText}}
{{parentSection}}

WHAT THE USER WANTS TO SAY (interpret these bullets — they are NOT the literal reply text)
{{bullets}}`,
      slots: [
        'styleGuide',
        'exclusions',
        'examples',
        'targetText',
        'parentSection',
        'bullets',
        'charConstraint',
      ],
    },
    post: {
      name: 'Post',
      body: `You are writing a standalone post on X in the user's voice. Output ONLY the post text — no preamble, no quotation marks around it, no commentary.

VOICE GUIDE
{{styleGuide}}

PATTERNS TO AVOID
{{exclusions}}

LENGTH
{{charConstraint}}
===USER===
EXAMPLES OF THE USER'S OWN POSTS (sample these for tone and rhythm, not topic)
{{examples}}

WHAT THE USER WANTS TO SAY (interpret these bullets — they are NOT the literal post text)
{{bullets}}`,
      slots: ['styleGuide', 'exclusions', 'examples', 'bullets', 'charConstraint'],
    },
    repair: {
      name: 'Repair',
      body: `Your previous draft used patterns the user asked to avoid:
{{violations}}

Rewrite the draft WITHOUT those patterns, keeping the same voice, length, and intent. Output ONLY the rewritten text — no preamble, no quotation marks around it.

PREVIOUS DRAFT
{{previousDraft}}`,
      slots: ['violations', 'previousDraft'],
    },
    chipRefine: {
      name: 'Chip refine',
      body: `Refine the previous draft per this single instruction. Keep the same voice and intent. Output ONLY the rewritten text — no preamble, no quotation marks around it.

INSTRUCTION
{{instruction}}

PREVIOUS DRAFT
{{previousDraft}}`,
      slots: ['instruction', 'previousDraft'],
    },
    moreLessRefine: {
      name: 'More / less refine',
      body: `Refine the previous draft per these notes. Keep the same voice and intent. Output ONLY the rewritten text — no preamble, no quotation marks around it.

MORE OF (emphasise / add)
{{more}}

LESS OF (de-emphasise / avoid)
{{less}}

PREVIOUS DRAFT
{{previousDraft}}`,
      slots: ['more', 'less', 'previousDraft'],
    },
    tighten: {
      name: 'Tighten',
      body: `The previous draft is over the 280-character X limit. Tighten it to fit under 280 characters, preserving voice and meaning. Output ONLY the tightened text — no preamble, no quotation marks around it.

PREVIOUS DRAFT
{{previousDraft}}`,
      slots: ['previousDraft'],
    },
  },
};
