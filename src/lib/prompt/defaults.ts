/**
 * Default prompt templates and the helpers that build the values
 * passed into them. Everything here is pure so the Prompts tab can
 * render the exact text the orchestrator will assemble.
 *
 * The exclusion instructions are *prevention-first*: the prompt itself
 * tells the model what to avoid so most drafts come back clean. The
 * deterministic check + single repair is a backstop, not the primary
 * lever (CLAUDE.md ethos).
 */
import type { LibraryItem, PromptTemplate, Settings } from '../../types';

export const DEFAULT_REPLY_TEMPLATE: PromptTemplate = {
  name: 'Reply',
  body: `You are writing a reply on X in the user's voice. Output ONLY the reply text — no preamble, no quotation marks around it, no commentary.

VOICE GUIDE
{{styleGuide}}

PATTERNS TO AVOID
{{exclusions}}

EXAMPLES OF THE USER'S OWN REPLIES (sample these for tone and rhythm, not topic)
{{examples}}

THE TWEET BEING REPLIED TO (by someone else)
{{targetText}}
{{parentSection}}

WHAT THE USER WANTS TO SAY (interpret these bullets — they are NOT the literal reply text)
{{bullets}}

LENGTH
{{charConstraint}}`,
  slots: [
    'styleGuide',
    'exclusions',
    'examples',
    'targetText',
    'parentSection',
    'bullets',
    'charConstraint',
  ],
};

export const DEFAULT_POST_TEMPLATE: PromptTemplate = {
  name: 'Post',
  body: `You are writing a standalone post on X in the user's voice. Output ONLY the post text — no preamble, no quotation marks around it, no commentary.

VOICE GUIDE
{{styleGuide}}

PATTERNS TO AVOID
{{exclusions}}

EXAMPLES OF THE USER'S OWN POSTS (sample these for tone and rhythm, not topic)
{{examples}}

WHAT THE USER WANTS TO SAY (interpret these bullets — they are NOT the literal post text)
{{bullets}}

LENGTH
{{charConstraint}}`,
  slots: ['styleGuide', 'exclusions', 'examples', 'bullets', 'charConstraint'],
};

export const DEFAULT_REPAIR_TEMPLATE: PromptTemplate = {
  name: 'Repair',
  body: `Your previous draft used patterns the user asked to avoid:
{{violations}}

Rewrite the draft WITHOUT those patterns, keeping the same voice, length, and intent. Output ONLY the rewritten text — no preamble, no quotation marks around it.

PREVIOUS DRAFT
{{previousDraft}}`,
  slots: ['violations', 'previousDraft'],
};

/** Format a list of library items as a numbered block for the
 *  {{examples}} slot. Cold-start (empty list) returns a one-line note
 *  so the surrounding template still reads naturally. */
export function formatExamples(items: LibraryItem[]): string {
  if (items.length === 0) {
    return '(none captured yet — lean on the voice guide alone)';
  }
  return items
    .map((item, idx) => `${String(idx + 1)}) ${item.text.trim()}`)
    .join('\n\n');
}

/** Build the {{exclusions}} slot value from the active structural
 *  rules + do-not-say entries. If everything is off and the banlist is
 *  empty, returns a single line so the section never reads as blank. */
export function buildExclusionInstructions(settings: Settings): string {
  const lines: string[] = [];
  if (settings.structuralRules.noEmDash) {
    lines.push('- Do not use em dashes (—). Use commas instead.');
  }
  if (settings.structuralRules.noSmartQuotes) {
    lines.push("- Do not use curly/smart quotes. Use straight ' and \" only.");
  }
  if (settings.structuralRules.noStaccato) {
    lines.push(
      '- Do not write 3 or more consecutive sentences of 4 words or fewer. Vary sentence length.',
    );
  }
  const banlist = settings.doNotSay.map((w) => w.trim()).filter((w) => w.length > 0);
  if (banlist.length > 0) {
    lines.push(`- Do not use these words or phrases: ${banlist.join(', ')}`);
  }
  if (lines.length === 0) return '(none active)';
  return lines.join('\n');
}

/** Build the {{charConstraint}} slot value. Char constraints are an
 *  *instruction*, not a hard validation, in Chunk 3 — exact counting +
 *  overage repair land in Chunk 4. */
export function buildCharConstraintInstruction(opts: {
  charCap: boolean;
  softCapChars: number;
}): string {
  if (opts.charCap) {
    return 'Keep the reply strictly under 280 characters total (the X single-tweet limit).';
  }
  return `Aim for at most ${String(opts.softCapChars)} characters total. Shorter is fine.`;
}

/** Build the optional {{parentSection}} slot value for reply mode.
 *  When there's no grandparent (i.e. the target is itself a top-level
 *  post), returns the empty string so the line collapses cleanly. */
export function buildParentSection(grandparentText: string | null): string {
  const trimmed = grandparentText?.trim() ?? '';
  if (trimmed === '') return '';
  return `\nWHICH WAS A REPLY TO\n${trimmed}`;
}
