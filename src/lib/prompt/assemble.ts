/**
 * Prompt assembly for the generation pipeline — the text-shaping brain
 * that decides exactly what the model is asked. Pure functions only
 * (CLAUDE.md §3): the background worker composes these; nothing here
 * touches chrome.*, fetch, or the DOM.
 */
import type { GenerationRequest, LibraryItem, Settings } from '../../types';
import type { Span } from '../exclusion';
import {
  buildAspirationalBlock,
  buildCharConstraintInstruction,
  buildExclusionInstructions,
  buildThreadContextBlock,
  formatExamples,
  GENERATION_PRECEDENCE,
  INTENT_FRAMING,
  REFINE_PRECEDENCE,
  type IntentShape,
} from './defaults';
import { renderTemplate, type RenderedPrompt } from './template';

/**
 * The example pools the initial prompt draws from, behind the
 * `selectExamples` seam. `aspirational` is deliberately empty in v1
 * (its block collapses); favorites feed it in roadmap Phase 5. The
 * model never learns which pool an example came from beyond the block
 * it appears in.
 */
export interface ExamplePools {
  voice: LibraryItem[];
  aspirational: LibraryItem[];
}

/**
 * Build the initial generation prompt for a post or reply request by
 * filling the mode's template slots from settings + sampled pools.
 * Returns the system/user pair the orchestrator sends as separate
 * message roles. Empty style guide / bullets render as explicit
 * placeholder lines so the template never reads as broken.
 */
export function assembleInitialPrompt(
  request: GenerationRequest,
  settings: Settings,
  pools: ExamplePools,
): RenderedPrompt {
  const template = settings.promptTemplates[request.mode];
  const slots: Record<string, string> = {
    precedence: GENERATION_PRECEDENCE,
    styleGuide:
      settings.styleGuide.trim() === ''
        ? '(no style guide set — infer voice from the examples)'
        : settings.styleGuide.trim(),
    exclusions: buildExclusionInstructions(settings),
    aspirationalExamples: buildAspirationalBlock(pools.aspirational),
    voiceExamples: formatExamples(pools.voice),
    length: buildCharConstraintInstruction({
      charCap: request.charCap,
      softCapChars: settings.softCapChars,
    }),
    intentFraming: INTENT_FRAMING[classifyIntentShape(request.bullets)],
    bullets: request.bullets.trim() === '' ? '(no bullets given)' : request.bullets.trim(),
  };
  if (request.mode === 'reply') {
    const ctx = request.replyContext;
    slots.targetText = ctx?.targetText ?? '(no target captured)';
    slots.threadContext = buildThreadContextBlock(ctx?.grandparentText ?? null);
  }
  return renderTemplate(template, slots);
}

/**
 * Build a refine prompt — chip, more/less, repair, and tighten all go
 * through here, so every revision pass carries the same voice anchor
 * (style guide + exclusions in the system body) as generation. The
 * instruction is panel-supplied for chip/more-less and code-supplied
 * for repair/tighten (`buildRepairInstruction`, `TIGHTEN_INSTRUCTION`).
 */
export function assembleRefinePrompt(
  settings: Settings,
  previousDraftText: string,
  instruction: string,
): RenderedPrompt {
  return renderTemplate(settings.promptTemplates.refine, {
    precedence: REFINE_PRECEDENCE,
    styleGuide:
      settings.styleGuide.trim() === ''
        ? "(no style guide set — preserve the draft's existing voice)"
        : settings.styleGuide.trim(),
    exclusions: buildExclusionInstructions(settings),
    draft: previousDraftText,
    instruction,
  });
}

/**
 * Classify the shape of the user's intent notes so the prompt can frame
 * them correctly (`INTENT_FRAMING`): scattered fragments get "find the
 * throughline and weave them", a written-out direction gets "develop and
 * tighten". Fragments = two or more non-empty lines, or a single line
 * that starts with a list marker (-, *, •). Everything else — including
 * empty input — reads as prose. Deliberately this simple: a wrong guess
 * costs one framing sentence, not the draft.
 */
export function classifyIntentShape(bullets: string): IntentShape {
  const lines = bullets
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length >= 2) return 'fragments';
  const onlyLine = lines[0];
  if (onlyLine !== undefined && /^[-*•]/.test(onlyLine)) return 'fragments';
  return 'prose';
}

/**
 * Render a violation list as the bullet block `buildRepairInstruction`
 * embeds. One line per structural rule that fired (regardless of how
 * many spans), plus one line naming the distinct banlist entries that
 * matched.
 */
export function summarizeViolations(violations: Span[]): string {
  const lines: string[] = [];
  const rules = new Set(violations.map((v) => v.rule));
  if (rules.has('emDash')) lines.push('- em dashes (use commas)');
  if (rules.has('smartQuote')) lines.push('- curly/smart quotes (use straight quotes)');
  if (rules.has('staccato')) {
    lines.push('- 3 or more consecutive sentences of 4 words or fewer');
  }
  if (rules.has('aiColon')) {
    lines.push('- the label-colon construction ("The result: …") — rewrite as full sentences');
  }
  const banlistEntries = Array.from(
    new Set(
      violations
        .filter((v) => v.rule === 'doNotSay')
        .map((v) => v.entry?.trim())
        .filter((e): e is string => typeof e === 'string' && e.length > 0),
    ),
  );
  if (banlistEntries.length > 0) {
    lines.push(`- the following words/phrases: ${banlistEntries.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Wrap a chip's stored instruction with an intensity preamble so
 * repeated presses produce compounding effects. The model sees the
 * same base instruction every time, but the framing escalates so it
 * understands the user is asking for MORE of the same direction —
 * not the same level of "more" each time.
 *
 * Press 1 → bare instruction.
 * Press 2 → "Push harder than a single pass."
 * Press 3 → "Third time asking. Apply dramatically."
 * Press 4+ → "Nth pass. Maximum intensity. Don't hold back."
 *
 * The previous draft is the result of the previous press, so the
 * compounding stacks naturally — each refine starts from the already-
 * refined version and pushes it further in the same direction.
 */
export function escalateChipInstruction(instruction: string, intensity: number): string {
  if (intensity <= 1) return instruction;
  if (intensity === 2) {
    return `${instruction}\n\nThis is the second press of the same chip — push noticeably harder than a single pass would. The previous draft is already the result of one application; this one should go further.`;
  }
  if (intensity === 3) {
    return `${instruction}\n\nThis is the third press of the same chip. The user has now asked for this direction three times. Apply the instruction dramatically — the result should be unmistakably more in this direction than the previous draft.`;
  }
  return `${instruction}\n\nThis is press #${String(intensity)} of the same chip. The user has repeatedly asked for this direction. Apply MAXIMUM intensity — don't be subtle. The result should be a clear, undeniable step in this direction beyond what the previous draft showed.`;
}

/**
 * Compose the panel's more/less steering fields into the single
 * instruction string the unified refine template expects. Either side
 * may be blank (one line comes back); both blank returns '' — callers
 * guard against sending an empty refine, this function just composes.
 */
export function composeMoreLessInstruction(more: string, less: string): string {
  const lines: string[] = [];
  const moreTrimmed = more.trim();
  const lessTrimmed = less.trim();
  if (moreTrimmed !== '') lines.push(`More of: ${moreTrimmed}`);
  if (lessTrimmed !== '') lines.push(`Less of: ${lessTrimmed}`);
  return lines.join('\n');
}
