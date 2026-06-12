/**
 * Generation, refine, and key-verification flows — the only code in the
 * extension that reads the API key and calls `api.anthropic.com`
 * (CLAUDE.md §6). The pure prompt-shaping lives in src/lib/prompt;
 * this module orchestrates storage reads, the calls, and the
 * deterministic post-processing.
 *
 * Pipeline shape:
 *   Generate:  sample → assemble → CALL → autoFix → exclusionRepair?
 *              → tightenRepair? → persistLastPrompt → reply
 *   Refine:    assemble → CALL → autoFix → exclusionRepair?
 *              → tightenRepair? → persistLastPrompt → reply
 *
 * Only Generate touches the example pool (re-runs selectExamples).
 * Refine reshapes whatever draft the panel sends. Every call — initial,
 * repair, tighten — carries a system block (role + precedence + style
 * guide + exclusions), so no pass is ever voice-blind.
 */
import { getAllItems, getApiKey, getBundle, getSettings, setLastPrompt } from '../../src/storage';
import type { PromptCall } from '../../src/storage';
import type { GenerationRequest, GenerationResult, RefineRequest, Settings } from '../../src/types';
import { selectExamples } from '../../src/lib/sampling';
import {
  autoFix,
  checkExclusions,
  hasRepairableViolations,
  type Span,
} from '../../src/lib/exclusion';
import {
  assembleInitialPrompt,
  assembleRefinePrompt,
  buildCharConstraintInstruction,
  buildCountNudgeLine,
  buildRepackInstruction,
  buildRepairInstruction,
  buildTightenSegmentsInstruction,
  escalateChipInstruction,
  POLISH_INSTRUCTION,
  REFIT_INSTRUCTION,
  summarizeViolations,
  THREAD_CAP_LINE,
  THREAD_FORMAT_REMINDER,
  TIGHTEN_INSTRUCTION,
  type RenderedPrompt,
} from '../../src/lib/prompt';
import { isOver280, weightedLength } from '../../src/lib/counting';
import { DEFAULT_THREAD_TARGET, joinSegments, parseThreadSegments } from '../../src/lib/thread';
import { callAnthropic, verifyKey } from '../../src/api/anthropic';

const MAX_TOKENS = 1024;
// A 7–9 post thread at ~280 chars/post needs far more output headroom
// than a single tweet; 1024 would silently truncate mid-thread.
const THREAD_MAX_TOKENS = 4096;

/** "Does the saved key work" probe behind the Account section's Verify button. */
export async function runVerifyKey(): Promise<{ ok: boolean; message: string }> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.keyStorageMode);
  const result = await verifyKey(apiKey, settings.model);
  return result.ok ? { ok: true, message: 'Key works.' } : { ok: false, message: result.message };
}

// ---------------------------------------------------------------------
// Generation entry — picks the example pool, builds the initial prompt,
// then hands off to the shared post-processing pipeline.
// ---------------------------------------------------------------------

export async function runGeneration(request: GenerationRequest): Promise<GenerationResult> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.keyStorageMode);
  if (apiKey === '') {
    return {
      ok: false,
      kind: 'auth',
      message: 'No API key set. Add one in the Account tab.',
    };
  }

  // Bundle-seeded generation: resolve the picked bundle up front. A
  // missing bundle (deleted between pick and generate) is an honest
  // error, never a silent fallback to sampling — the user asked for a
  // specific seed and should know they didn't get it.
  let bundle = null;
  if (request.bundleId != null) {
    bundle = await getBundle(request.bundleId);
    if (bundle === null) {
      return {
        ok: false,
        kind: 'bad-request',
        message: 'That bundle no longer exists. Pick another, or generate without one.',
      };
    }
  }

  const library = await getAllItems();
  const examples = selectExamples(
    request.mode,
    {
      parentText: request.replyContext?.targetText,
      grandparentText: request.replyContext?.grandparentText ?? undefined,
      bullets: request.bullets,
    },
    library,
    {
      poolSize: settings.poolSize,
      starCount: settings.starCount,
      curatedShare: settings.curatedArchiveBalance,
      ...(bundle !== null && { bundleMemberIds: bundle.memberIds }),
    },
  );

  // Stars feed <aspirational_examples> (guaranteed, on top); the
  // curated/archive sample feeds <voice_examples>. Both pools come
  // from the one selectExamples seam.
  const initialPrompt = assembleInitialPrompt(request, settings, {
    voice: examples.voice,
    aspirational: examples.aspirational,
    threads: examples.threads,
  });
  const temperature = request.isRegenerate
    ? settings.temperature.regenerate
    : settings.temperature.generate;

  // The inspector label carries the seed so a bundle-driven prompt is
  // visibly bundle-driven (transparency is load-bearing).
  const baseLabel = request.isRegenerate ? 'regenerate' : 'generate';
  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    kind: request.mode === 'thread' ? 'thread' : 'single',
    // Generates validate the count; refines don't (chips may
    // legitimately change it) — repack re-supplies a target.
    targetCount: request.mode === 'thread' ? (request.targetCount ?? DEFAULT_THREAD_TARGET) : null,
    charCap: request.charCap,
    initialPrompt,
    initialLabel: bundle !== null ? `${baseLabel} (bundle: ${bundle.name})` : baseLabel,
    temperature,
  });
}

// ---------------------------------------------------------------------
// Refine entry — composes the instruction (chip or freeform), renders
// it through the single refine template, then runs the same
// post-processing pipeline.
// ---------------------------------------------------------------------

export async function runRefine(request: RefineRequest): Promise<GenerationResult> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.keyStorageMode);
  if (apiKey === '') {
    return {
      ok: false,
      kind: 'auth',
      message: 'No API key set. Add one in the Account tab.',
    };
  }
  if (request.previousDraftText.trim() === '') {
    return {
      ok: false,
      kind: 'bad-request',
      message: 'No previous draft to refine.',
    };
  }

  const kind = request.kind;
  let instruction: string;
  let initialLabel: string;
  if (kind.type === 'chip') {
    const chip = settings.chips.find((c) => c.id === kind.chipId);
    if (!chip) {
      return {
        ok: false,
        kind: 'bad-request',
        message: `Chip "${kind.chipId}" not found in current settings.`,
      };
    }
    instruction = escalateChipInstruction(chip.instruction, kind.intensity);
    initialLabel =
      kind.intensity > 1
        ? `refine (chip: ${chip.label}, press ${String(kind.intensity)})`
        : `refine (chip: ${chip.label})`;
  } else if (kind.type === 'freeform') {
    instruction = kind.instruction.trim();
    if (instruction === '') {
      return {
        ok: false,
        kind: 'bad-request',
        message: 'The feedback box is empty — nothing to refine on.',
      };
    }
    initialLabel = 'refine (freeform)';
  } else if (kind.type === 'polish') {
    instruction = POLISH_INSTRUCTION;
    initialLabel = 'refine (polish)';
  } else if (kind.type === 'repack') {
    instruction = buildRepackInstruction(kind.targetCount);
    initialLabel = `refine (repack to \u2248${String(kind.targetCount)})`;
  } else {
    instruction = REFIT_INSTRUCTION;
    initialLabel = 'refine (refit to \u2264280)';
  }

  // The cap is a constraint; the instruction is a direction \u2014
  // constraints win. With the cap on, every refine carries the cap
  // line explicitly so the model aims AT the headroom ("Longer" means
  // longer-but-under-the-cap) instead of overshooting into the
  // reshape backstop, which would silently crush the result back. The
  // refit's own instruction already states the limit. Thread refines
  // get the per-post cap line and ALWAYS the format reminder — a
  // revision pass must never flatten the thread into one post.
  if (request.mode === 'thread') {
    if (request.charCap) {
      instruction = `${instruction}\n\n${THREAD_CAP_LINE}`;
    }
    instruction = `${instruction}\n\n${THREAD_FORMAT_REMINDER}`;
  } else if (request.charCap && kind.type !== 'refit') {
    instruction = `${instruction}\n\n${buildCharConstraintInstruction({
      charCap: true,
      softCapChars: settings.softCapChars,
    })}`;
  }

  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    kind: request.mode === 'thread' ? 'thread' : 'single',
    // Only a repack re-validates the post count — other refines act
    // holistically and may legitimately change it.
    targetCount: kind.type === 'repack' ? kind.targetCount : null,
    charCap: request.charCap,
    initialPrompt: assembleRefinePrompt(settings, request.previousDraftText, instruction),
    initialLabel,
    temperature: settings.temperature.generate,
  });
}

// ---------------------------------------------------------------------
// Shared pipeline: call → per-post autoFix/check → exclusion-repair?
// → reshape? → persistLastPrompt → result.
//
// The HARD CEILING is unchanged: at most three Anthropic calls per
// invocation —
//   1. Initial call
//   2. One exclusion repair (only if violations remain after autoFix;
//      in thread mode it also restates the count when drifted)
//   3. One reshape (single mode: the classic tighten when charCap is
//      on and the draft measures >280; thread mode: when any post is
//      over the cap and/or the post count drifted beyond ±1 of the
//      target)
// Thread invocations parse the --- wire format and process each post
// independently (autoFix, exclusions, weighted counts); every backstop
// instruction is code-composed from tested lib/prompt constants.
// ---------------------------------------------------------------------

interface PipelineOptions {
  apiKey: string;
  settings: Settings;
  mode: 'post' | 'reply' | 'thread';
  /** Single card vs thread cards — decides parsing and per-post math. */
  kind: 'single' | 'thread';
  /** Thread ≈N target to validate (generate/repack); null skips the
   *  count check. */
  targetCount: number | null;
  charCap: boolean;
  initialPrompt: RenderedPrompt;
  /** Inspector label for the initial call ('generate', 'refine (…)', …). */
  initialLabel: string;
  temperature: number;
}

/** One post after deterministic post-processing. */
interface ProcessedPost {
  text: string;
  violations: Span[];
}

/** Parse (threads) and run per-post autoFix + exclusion checks. */
function processDraftText(
  raw: string,
  kind: 'single' | 'thread',
  settings: Settings,
  fixOptions: { fixEmDash: boolean; fixSmartQuotes: boolean },
): { posts: ProcessedPost[]; appliedFixes: Span[] } {
  const rawPosts = kind === 'thread' ? parseThreadSegments(raw) : [raw];
  const posts: ProcessedPost[] = [];
  const appliedFixes: Span[] = [];
  for (const rawPost of rawPosts) {
    const fixed = autoFix(rawPost, fixOptions);
    const check = checkExclusions(fixed.text, settings);
    posts.push({ text: fixed.text, violations: check.violations });
    appliedFixes.push(...fixed.appliedFixes);
  }
  return { posts, appliedFixes };
}

async function runPipeline(opts: PipelineOptions): Promise<GenerationResult> {
  const { apiKey, settings, mode, kind, targetCount, charCap, initialPrompt, initialLabel } = opts;
  const fixOptions = {
    fixEmDash: settings.structuralRules.noEmDash,
    fixSmartQuotes: settings.structuralRules.noSmartQuotes,
  };
  const maxTokens = kind === 'thread' ? THREAD_MAX_TOKENS : MAX_TOKENS;
  const joined = (posts: ProcessedPost[]): string =>
    kind === 'thread' ? joinSegments(posts.map((p) => p.text)) : (posts[0]?.text ?? '');
  const countDrifted = (posts: ProcessedPost[]): boolean =>
    kind === 'thread' && targetCount !== null && Math.abs(posts.length - targetCount) > 1;

  const firstCall = await callAnthropic({
    apiKey,
    model: settings.model,
    system: initialPrompt.system,
    prompt: initialPrompt.user,
    temperature: opts.temperature,
    maxTokens,
  });
  if (!firstCall.ok) {
    return { ok: false, kind: firstCall.kind, message: firstCall.message };
  }
  if (firstCall.text.trim() === '') {
    return {
      ok: false,
      kind: 'other',
      message:
        'Anthropic returned no text content. Try Regenerate, or check the Prompts tab for a malformed template.',
    };
  }

  let processed = processDraftText(firstCall.text, kind, settings, fixOptions);
  let appliedAutoFixes: Span[] = processed.appliedFixes;
  let wasRepaired = false;
  // Every call in the invocation, recorded exactly as sent — the
  // inspector renders this verbatim. Transparency is load-bearing.
  const calls: PromptCall[] = [{ label: initialLabel, ...initialPrompt }];

  const allViolations = processed.posts.flatMap((p) => p.violations);
  if (hasRepairableViolations({ violations: allViolations })) {
    const violationsSummary = summarizeViolations(allViolations);
    let repairInstruction = buildRepairInstruction(violationsSummary);
    if (kind === 'thread') {
      // Fold the count nudge into the repair when both fired — one
      // combined instruction, no extra call.
      if (countDrifted(processed.posts)) {
        repairInstruction += `\n\n${buildCountNudgeLine(processed.posts.length, targetCount ?? 0)}`;
      }
      repairInstruction += `\n\n${THREAD_FORMAT_REMINDER}`;
    }
    const repairPrompt = assembleRefinePrompt(settings, joined(processed.posts), repairInstruction);

    const repairCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: repairPrompt.system,
      prompt: repairPrompt.user,
      temperature: settings.temperature.regenerate,
      maxTokens,
    });

    if (repairCall.ok) {
      const repaired = processDraftText(repairCall.text, kind, settings, fixOptions);
      processed = repaired;
      appliedAutoFixes = [...appliedAutoFixes, ...repaired.appliedFixes];
      wasRepaired = true;
      calls.push({
        label: `repair (${violationsSummary.replace(/\n/g, ' · ')})`,
        ...repairPrompt,
      });
    }
    // Repair call failed → keep first draft so the user still sees
    // something. Don't loop.
  }

  // The reshape backstop: over-cap posts (single's classic tighten is
  // the N=1 case) and/or thread count drift — one call, composed
  // instruction, then done. No loops.
  const overOrdinals = charCap
    ? processed.posts.flatMap((p, i) => (isOver280(p.text) ? [i + 1] : []))
    : [];
  const needsCount = countDrifted(processed.posts);
  if (overOrdinals.length > 0 || needsCount) {
    let reshapeInstruction: string;
    let reshapeLabel: string;
    if (kind === 'single') {
      reshapeInstruction = TIGHTEN_INSTRUCTION;
      reshapeLabel = `tighten (${String(weightedLength(processed.posts[0]?.text ?? ''))} → target ≤280)`;
    } else {
      const parts: string[] = [];
      if (overOrdinals.length > 0) parts.push(buildTightenSegmentsInstruction(overOrdinals));
      if (needsCount) {
        parts.push(buildCountNudgeLine(processed.posts.length, targetCount ?? 0));
      }
      parts.push(THREAD_FORMAT_REMINDER);
      reshapeInstruction = parts.join('\n\n');
      const why = [
        overOrdinals.length > 0 ? `posts over cap: ${overOrdinals.join(', ')}` : '',
        needsCount ? `count ${String(processed.posts.length)} → ≈${String(targetCount ?? 0)}` : '',
      ]
        .filter((w) => w !== '')
        .join(' · ');
      reshapeLabel = `reshape (${why})`;
    }
    const reshapePrompt = assembleRefinePrompt(
      settings,
      joined(processed.posts),
      reshapeInstruction,
    );
    const reshapeCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: reshapePrompt.system,
      prompt: reshapePrompt.user,
      temperature: settings.temperature.generate,
      maxTokens,
    });
    if (reshapeCall.ok) {
      const reshaped = processDraftText(reshapeCall.text, kind, settings, fixOptions);
      processed = reshaped;
      appliedAutoFixes = [...appliedAutoFixes, ...reshaped.appliedFixes];
      wasRepaired = true;
      calls.push({ label: reshapeLabel, ...reshapePrompt });
    }
    // Reshape failed → user sees the draft as-is; the per-post counts
    // and highlights in the panel will warn them.
  }

  await setLastPrompt({
    timestamp: Date.now(),
    mode,
    calls,
    response: joined(processed.posts),
    wasRepaired,
  });

  return {
    ok: true,
    kind,
    targetCount,
    draft: {
      posts: processed.posts.map((p) => ({
        text: p.text,
        characterCount: weightedLength(p.text),
        residualViolations: p.violations,
      })),
    },
    appliedAutoFixes,
    wasRepaired,
  };
}
