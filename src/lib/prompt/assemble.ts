/**
 * Prompt assembly for the generation pipeline — the text-shaping brain
 * that decides exactly what the model is asked. Pure functions only
 * (CLAUDE.md §3): the background worker composes these; nothing here
 * touches chrome.*, fetch, or the DOM.
 */
import type { GenerationRequest, LibraryItem, Settings } from '../../types';
import type { Span } from '../exclusion';
import {
  buildCharConstraintInstruction,
  buildExclusionInstructions,
  buildParentSection,
  formatExamples,
} from './defaults';
import { renderTemplate } from './template';

/**
 * Build the initial generation prompt for a post or reply request by
 * filling the mode's template slots from settings + sampled examples.
 * Empty style guide / bullets render as explicit placeholder lines so
 * the template never reads as broken.
 */
export function assembleInitialPrompt(
  request: GenerationRequest,
  settings: Settings,
  examples: LibraryItem[],
): string {
  const template = settings.promptTemplates[request.mode];
  const slots: Record<string, string> = {
    styleGuide:
      settings.styleGuide.trim() === ''
        ? '(no style guide set — infer voice from the examples)'
        : settings.styleGuide.trim(),
    exclusions: buildExclusionInstructions(settings),
    examples: formatExamples(examples),
    bullets: request.bullets.trim() === '' ? '(no bullets given)' : request.bullets.trim(),
    charConstraint: buildCharConstraintInstruction({
      charCap: request.charCap,
      softCapChars: settings.softCapChars,
    }),
  };
  if (request.mode === 'reply') {
    const ctx = request.replyContext;
    slots.targetText = ctx?.targetText ?? '(no target captured)';
    slots.parentSection = buildParentSection(ctx?.grandparentText ?? null);
  }
  return renderTemplate(template, slots);
}

/**
 * Render a violation list as the bullet block the repair template's
 * {{violations}} slot expects. One line per structural rule that fired
 * (regardless of how many spans), plus one line naming the distinct
 * banlist entries that matched.
 */
export function summarizeViolations(violations: Span[]): string {
  const lines: string[] = [];
  const rules = new Set(violations.map((v) => v.rule));
  if (rules.has('emDash')) lines.push('- em dashes (use commas)');
  if (rules.has('smartQuote')) lines.push('- curly/smart quotes (use straight quotes)');
  if (rules.has('staccato')) {
    lines.push('- 3 or more consecutive sentences of 4 words or fewer');
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
