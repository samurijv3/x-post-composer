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

/** Precedence preamble for THREAD generation calls — ranks the
 *  thread-specific block and drops reply context (threads are
 *  standalone posts in v1). See `GENERATION_PRECEDENCE`. */
export const THREAD_PRECEDENCE = `When instructions conflict, this is the order of authority:
1. <exclusions> are hard constraints. Never violate them, even if an example does.
2. <style_guide> is the authoritative description of the user's voice.
3. <thread_examples>, when present, are complete threads the user has written — match how they pace and structure a thread (how posts open, close, and hand off to the next), never their topics.
4. <aspirational_examples>, when present, are the user's own writing at its best — the bar to reach for.
5. <voice_examples> show the user's natural range. Match their tone and rhythm, never their topics.
6. <intent> is what the user wants to say. Develop it; do not copy it verbatim.`;

/** Precedence preamble for refine calls (chip, freeform, repair,
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
  thread: {
    name: 'Thread',
    system: `You are writing an X thread — one post followed by successive posts, all one continuous piece — in the user's voice. Output ONLY the thread text: the posts in order, separated by a line containing only ---. No preamble, no numbering, no commentary.

<precedence>
{{precedence}}
</precedence>

<style_guide>
{{styleGuide}}
</style_guide>

<exclusions>
{{exclusions}}
</exclusions>`,
    user: `{{threadExamples}}{{aspirationalExamples}}<voice_examples>
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
      'threadExamples',
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

/** Instruction behind the panel's Polish button — one code-supplied
 *  tightening/refinement pass through the refine template, with the
 *  usual pipeline backstops. Deliberately length-preserving: tightening
 *  to ≤280 is the refit's job, not polish's. */
export const POLISH_INSTRUCTION =
  'Give the draft one final polish: tighten loose phrasing, smooth the rhythm, and cut filler. Do not change its meaning, its stance, or its overall length.';

/** Instruction behind flipping the ≤280 toggle ON over an existing
 *  draft — a REFIT, never a regenerate: the draft's content is the
 *  fixed point; only its length changes. Code-supplied. */
export const REFIT_INSTRUCTION =
  'The draft must now fit the 280-character X limit. Refit it: keep its content, voice, and intent exactly; change only what the length requires.';

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

/** Build the optional {{threadExamples}} slot value — complete threads
 *  the user has written, each rendered as ONE example with `1/ 2/ …`
 *  segment markers (the boundaries ARE the pacing signal; the joined
 *  flow is the throughline). Empty pool collapses to '' like the
 *  aspirational block. The pacing instruction lives in
 *  `THREAD_PRECEDENCE`, not here — precedence ranks the blocks. */
export function buildThreadExamplesBlock(items: LibraryItem[]): string {
  if (items.length === 0) return '';
  const rendered = items
    .map((item, idx) => {
      const segments = item.segments?.map((s) => s.text) ?? [item.text];
      const marked = segments.map((text, i) => `${String(i + 1)}/ ${text.trim()}`).join('\n\n');
      return `${String(idx + 1)})\n${marked}`;
    })
    .join('\n\n');
  return `<thread_examples>\n${rendered}\n</thread_examples>\n\n`;
}

/** Build the {{length}} slot value for THREAD generation: the soft ≈N
 *  post target plus the per-post cap. Both facts are baked (the
 *  pipeline validates them), filled into one slot. */
export function buildThreadConstraintInstruction(opts: {
  charCap: boolean;
  softCapChars: number;
  targetCount: number;
}): string {
  const target = `Aim for about ${String(opts.targetCount)} posts — one over or under is fine when the content demands it.`;
  const perPost = opts.charCap
    ? THREAD_CAP_LINE
    : `Aim for at most ${String(opts.softCapChars)} characters per post. Shorter is fine.`;
  return `${target} ${perPost}`;
}

/** The per-post half of the thread length constraint — also appended
 *  in code to thread-mode refine instructions when the cap is on
 *  (chips must aim at the per-post headroom, same prevention-first
 *  logic as the single-mode cap line). */
export const THREAD_CAP_LINE =
  'Keep each post strictly under 280 characters (the X single-post limit).';

/** Appended in code to every thread-mode refine instruction so a
 *  revision pass can never silently flatten the thread into one post —
 *  the format is machinery, not a preference. */
export const THREAD_FORMAT_REMINDER =
  'The draft is an X thread: posts in order, separated by a line containing only ---. Keep exactly that format in your output — no preamble, no numbering, no commentary.';

/** Instruction behind changing the ≈N stepper over an active thread —
 *  a REPACK, never a regenerate: content is the fixed point; only the
 *  packaging changes. Code-supplied, like `REFIT_INSTRUCTION`. */
export function buildRepackInstruction(targetCount: number): string {
  return `The thread's content is the fixed point. Repackage it into about ${String(targetCount)} posts: keep its content, voice, and intent exactly; change only how it is split across posts.`;
}

/** Instruction for the thread reshape backstop when specific posts
 *  measure over the 280 cap — names the offenders, spares the rest. */
export function buildTightenSegmentsInstruction(overOrdinals: number[]): string {
  const list = overOrdinals.join(', ');
  const plural = overOrdinals.length > 1;
  return `Post${plural ? 's' : ''} ${list} ${plural ? 'are' : 'is'} over the 280-character X limit. Tighten ${plural ? 'those posts' : 'that post'} to fit under 280 characters each, preserving voice and meaning. Leave the other posts unchanged.`;
}

/** One line for the reshape backstop when the post count drifted past
 *  the ±1 band around the target. */
export function buildCountNudgeLine(actual: number, target: number): string {
  return `The thread currently has ${String(actual)} post${actual === 1 ? '' : 's'}; the target is about ${String(target)}. Adjust the packaging toward ${String(target)} posts without dropping content.`;
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
