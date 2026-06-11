/**
 * Default prompt templates and the helpers that build the values
 * passed into them. Everything here is pure so the Prompts tab can
 * render the exact text the orchestrator will assemble.
 *
 * Block structure: XML-style tags delimit every block. The system body
 * carries the invariant framing (role, precedence, style guide,
 * exclusions); the user body carries the per-call content (examples,
 * reply context, length, intent / draft + instruction). The boundary
 * test for what goes where: does this block change between two
 * consecutive calls? Invariant → system, varying → user. Keeping
 * per-call content out of the system body also keeps the system block
 * cacheable later (deliberately NOT implemented now).
 *
 * The exclusion instructions are *prevention-first*: the prompt itself
 * tells the model what to avoid so most drafts come back clean. The
 * deterministic check + single repair is a backstop, not the primary
 * lever (CLAUDE.md ethos).
 */
import type { LibraryItem, PromptTemplate, PromptTemplateKey, Settings } from '../../types';

/**
 * Precedence preamble for generation calls, filling the {{precedence}}
 * slot. Code-supplied (not user-editable prose) so the authority order
 * the pipeline relies on can't silently drift — the user can still see
 * exactly what's sent via the inspector, and can remove the slot from
 * their template if they truly want to.
 */
export const GENERATION_PRECEDENCE = `When instructions conflict, this is the order of authority:
1. <exclusions> are hard constraints. Never violate them, even if an example does.
2. <style_guide> is the authoritative description of the user's voice.
3. <aspirational_examples>, when present, are the user's own writing at its best — the bar to reach for.
4. <voice_examples> show the user's natural range. Match their tone and rhythm, never their topics.
5. <reply_context>, when present, is the tweet being replied to — written by someone else. React to it; never imitate its voice.
6. <intent> is what the user wants to say. Develop it; do not copy it verbatim.`;

/** Precedence preamble for refine calls (chip, more/less, repair,
 *  tighten all share one template). See `GENERATION_PRECEDENCE`. */
export const REFINE_PRECEDENCE = `When instructions conflict, this is the order of authority:
1. <exclusions> are hard constraints. Never violate them.
2. <style_guide> is the authoritative description of the user's voice — keep the revision inside it.
3. <instruction> says what to change. Preserve everything about <draft> that <instruction> does not ask you to change.`;

/**
 * THE single source of truth for the default templates. `DEFAULT_SETTINGS`
 * imports this record — there is deliberately no second copy anywhere.
 *
 * Three templates: `reply` and `post` for generation, one `refine` for
 * every revision pass — chips and freeform steering fill {{instruction}}
 * from the panel; repair and tighten fill it with code-supplied
 * instructions (`buildRepairInstruction`, `TIGHTEN_INSTRUCTION`). Every
 * refinement therefore carries the same voice anchor (style guide +
 * exclusions) as generation — refine calls are never voice-blind.
 */
export const DEFAULT_PROMPT_TEMPLATES: Record<PromptTemplateKey, PromptTemplate> = {
  reply: {
    name: 'Reply',
    system: `You are writing a reply on X in the user's voice. Output ONLY the reply text — no preamble, no quotation marks around it, no commentary.

<precedence>
{{precedence}}
</precedence>

<style_guide>
{{styleGuide}}
</style_guide>

<exclusions>
{{exclusions}}
</exclusions>`,
    user: `{{aspirationalExamples}}<voice_examples>
{{voiceExamples}}
</voice_examples>
{{threadContext}}
<reply_context>
{{targetText}}
</reply_context>

<length>
{{length}}
</length>

<intent>
{{intentFraming}}

{{bullets}}
</intent>`,
    slots: [
      'precedence',
      'styleGuide',
      'exclusions',
      'aspirationalExamples',
      'voiceExamples',
      'threadContext',
      'targetText',
      'length',
      'intentFraming',
      'bullets',
    ],
  },
  post: {
    name: 'Post',
    system: `You are writing a standalone post on X in the user's voice. Output ONLY the post text — no preamble, no quotation marks around it, no commentary.

<precedence>
{{precedence}}
</precedence>

<style_guide>
{{styleGuide}}
</style_guide>

<exclusions>
{{exclusions}}
</exclusions>`,
    user: `{{aspirationalExamples}}<voice_examples>
{{voiceExamples}}
</voice_examples>

<length>
{{length}}
</length>

<intent>
{{intentFraming}}

{{bullets}}
</intent>`,
    slots: [
      'precedence',
      'styleGuide',
      'exclusions',
      'aspirationalExamples',
      'voiceExamples',
      'length',
      'intentFraming',
      'bullets',
    ],
  },
  refine: {
    name: 'Refine',
    system: `You are revising a draft written in the user's voice for X. Output ONLY the revised text — no preamble, no quotation marks around it, no commentary.

<precedence>
{{precedence}}
</precedence>

<style_guide>
{{styleGuide}}
</style_guide>

<exclusions>
{{exclusions}}
</exclusions>`,
    user: `<draft>
{{draft}}
</draft>

<instruction>
{{instruction}}
</instruction>`,
    slots: ['precedence', 'styleGuide', 'exclusions', 'draft', 'instruction'],
  },
};

/** The two shapes the user's intent notes can take, as judged by
 *  `classifyIntentShape` (lib/prompt/assemble). Keys of `INTENT_FRAMING`. */
export type IntentShape = 'fragments' | 'prose';

/**
 * Framing line that precedes the user's notes inside the intent block,
 * chosen per-call by `classifyIntentShape`. Code-supplied rather than a
 * user-editable slot so the heuristic and its wording live in one tested
 * place — the editable template carries the {{intentFraming}} slot, this
 * record carries what fills it.
 */
export const INTENT_FRAMING: Record<IntentShape, string> = {
  fragments:
    "The user's notes below are loose thoughts, not literal text to publish. Find the throughline and weave them into one piece.",
  prose:
    "The user's notes below are a direction to develop and tighten, not literal text to publish.",
};

/** Instruction the pipeline feeds the refine template's {{instruction}}
 *  slot for the (at most one) tighten pass. Code-supplied: tighten is a
 *  pipeline backstop, not a user-authored ask. */
export const TIGHTEN_INSTRUCTION =
  'The draft is over the 280-character X limit. Tighten it to fit under 280 characters, preserving voice and meaning.';

/** Build the {{instruction}} value for the (at most one) exclusion-repair
 *  pass from `summarizeViolations` output. Code-supplied, like
 *  `TIGHTEN_INSTRUCTION`. */
export function buildRepairInstruction(violationsSummary: string): string {
  return `The draft uses patterns the user asked to avoid:
${violationsSummary}

Rewrite it without those patterns, keeping the same voice, length, and intent.`;
}

/** Format a list of library items as a numbered block for the
 *  {{voiceExamples}} slot. Cold-start (empty list) returns a one-line
 *  note so the surrounding template still reads naturally. */
export function formatExamples(items: LibraryItem[]): string {
  if (items.length === 0) {
    return '(none captured yet — lean on the voice guide alone)';
  }
  return items.map((item, idx) => `${String(idx + 1)}) ${item.text.trim()}`).join('\n\n');
}

/** Build the optional {{aspirationalExamples}} slot value — the user's
 *  own writing at its best, the bar to reach for. Ships present-but-
 *  empty: nothing feeds the pool until favorites land (roadmap Phase 5),
 *  and an empty pool collapses to '' so the template never shows an
 *  empty section. Returns the whole tagged block including trailing
 *  separation, mirroring `buildThreadContextBlock`. */
export function buildAspirationalBlock(items: LibraryItem[]): string {
  if (items.length === 0) return '';
  return `<aspirational_examples>\n${formatExamples(items)}\n</aspirational_examples>\n\n`;
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
    lines.push('- Do not use curly/smart quotes. Use straight \' and " only.');
  }
  if (settings.structuralRules.noStaccato) {
    lines.push(
      '- Do not write 3 or more consecutive sentences of 4 words or fewer. Vary sentence length.',
    );
  }
  if (settings.structuralRules.noAiColon) {
    lines.push(
      '- Do not open sentences with a label-colon fragment ("The result: …", "The real leverage: …"). Write the full sentence instead.',
    );
  }
  const banlist = settings.doNotSay.map((w) => w.trim()).filter((w) => w.length > 0);
  if (banlist.length > 0) {
    lines.push(`- Do not use these words or phrases: ${banlist.join(', ')}`);
  }
  if (lines.length === 0) return '(none active)';
  return lines.join('\n');
}

/** Build the {{length}} slot value — the prompt-side half of length
 *  control. The deterministic half lives in the pipeline: when the cap
 *  is on and the draft still measures >280 (lib/counting), one tighten
 *  re-prompt fires. The soft cap has no deterministic gate. */
export function buildCharConstraintInstruction(opts: {
  charCap: boolean;
  softCapChars: number;
}): string {
  if (opts.charCap) {
    return 'Keep the final text strictly under 280 characters total (the X single-tweet limit).';
  }
  return `Aim for at most ${String(opts.softCapChars)} characters total. Shorter is fine.`;
}

/** Build the optional {{threadContext}} slot value for reply mode.
 *  When there's no grandparent (i.e. the target is itself a top-level
 *  post), returns the empty string so the line collapses cleanly. */
export function buildThreadContextBlock(grandparentText: string | null): string {
  const trimmed = grandparentText?.trim() ?? '';
  if (trimmed === '') return '';
  return `\n<thread_context>\nThe tweet in <reply_context> was itself a reply to:\n${trimmed}\n</thread_context>\n`;
}
