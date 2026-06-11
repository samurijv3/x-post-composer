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
import { getAllItems, getApiKey, getSettings, setLastPrompt } from '../../src/storage';
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
  buildRepairInstruction,
  escalateChipInstruction,
  POLISH_INSTRUCTION,
  REFIT_INSTRUCTION,
  summarizeViolations,
  TIGHTEN_INSTRUCTION,
  type RenderedPrompt,
} from '../../src/lib/prompt';
import { isOver280, weightedLength } from '../../src/lib/counting';
import { callAnthropic, verifyKey } from '../../src/api/anthropic';

const MAX_TOKENS = 1024;

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

  const library = await getAllItems();
  const examples = selectExamples(
    request.mode,
    {
      parentText: request.replyContext?.targetText,
      grandparentText: request.replyContext?.grandparentText ?? undefined,
      bullets: request.bullets,
    },
    library,
    { poolSize: settings.poolSize },
  );

  // The aspirational pool is empty until favorites land (roadmap
  // Phase 5) — its template block collapses cleanly. Wire the real
  // pool here, behind the same selectExamples seam.
  const initialPrompt = assembleInitialPrompt(request, settings, {
    voice: examples,
    aspirational: [],
  });
  const temperature = request.isRegenerate
    ? settings.temperature.regenerate
    : settings.temperature.generate;

  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    charCap: request.charCap,
    initialPrompt,
    initialLabel: request.isRegenerate ? 'regenerate' : 'generate',
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
  } else {
    instruction = REFIT_INSTRUCTION;
    initialLabel = 'refine (refit to \u2264280)';
  }

  // The cap is a constraint; the instruction is a direction \u2014
  // constraints win. With the cap on, every refine carries the 280
  // line explicitly so the model aims AT the headroom ("Longer" means
  // longer-but-under-280) instead of overshooting into the tighten
  // backstop, which would silently crush the result back. The refit's
  // own instruction already states the limit.
  if (request.charCap && kind.type !== 'refit') {
    instruction = `${instruction}\n\n${buildCharConstraintInstruction({
      charCap: true,
      softCapChars: settings.softCapChars,
    })}`;
  }

  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    charCap: request.charCap,
    initialPrompt: assembleRefinePrompt(settings, request.previousDraftText, instruction),
    initialLabel,
    temperature: settings.temperature.generate,
  });
}

// ---------------------------------------------------------------------
// Shared pipeline: call → autoFix → exclusion-repair? → tighten-repair?
// → persistLastPrompt → result.
//
// At most three Anthropic calls per invocation:
//   1. Initial call
//   2. One exclusion repair (only if violations remain after autoFix)
//   3. One tighten repair (only if charCap is on AND draft still > 280)
// ---------------------------------------------------------------------

interface PipelineOptions {
  apiKey: string;
  settings: Settings;
  mode: 'post' | 'reply';
  charCap: boolean;
  initialPrompt: RenderedPrompt;
  /** Inspector label for the initial call ('generate', 'refine (…)', …). */
  initialLabel: string;
  temperature: number;
}

async function runPipeline(opts: PipelineOptions): Promise<GenerationResult> {
  const { apiKey, settings, mode, charCap, initialPrompt, initialLabel, temperature } = opts;
  const fixOptions = {
    fixEmDash: settings.structuralRules.noEmDash,
    fixSmartQuotes: settings.structuralRules.noSmartQuotes,
  };

  const firstCall = await callAnthropic({
    apiKey,
    model: settings.model,
    system: initialPrompt.system,
    prompt: initialPrompt.user,
    temperature,
    maxTokens: MAX_TOKENS,
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

  const firstFixed = autoFix(firstCall.text, fixOptions);
  const firstCheck = checkExclusions(firstFixed.text, settings);

  let finalText = firstFixed.text;
  let appliedAutoFixes: Span[] = firstFixed.appliedFixes;
  let residualViolations = firstCheck.violations;
  let wasRepaired = false;
  // Every call in the invocation, recorded exactly as sent — the
  // inspector renders this verbatim. Transparency is load-bearing.
  const calls: PromptCall[] = [{ label: initialLabel, ...initialPrompt }];

  if (hasRepairableViolations(firstCheck)) {
    const violationsSummary = summarizeViolations(firstCheck.violations);
    const repairPrompt = assembleRefinePrompt(
      settings,
      firstFixed.text,
      buildRepairInstruction(violationsSummary),
    );

    const repairCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: repairPrompt.system,
      prompt: repairPrompt.user,
      temperature: settings.temperature.regenerate,
      maxTokens: MAX_TOKENS,
    });

    if (repairCall.ok) {
      const repaired = autoFix(repairCall.text, fixOptions);
      const repairedCheck = checkExclusions(repaired.text, settings);
      finalText = repaired.text;
      appliedAutoFixes = [...firstFixed.appliedFixes, ...repaired.appliedFixes];
      residualViolations = repairedCheck.violations;
      wasRepaired = true;
      calls.push({
        label: `repair (${violationsSummary.replace(/\n/g, ' · ')})`,
        ...repairPrompt,
      });
    }
    // Repair call failed → keep first draft so the user still sees
    // something. Don't loop.
  }

  if (charCap && isOver280(finalText)) {
    const overLength = weightedLength(finalText);
    const tightenPrompt = assembleRefinePrompt(settings, finalText, TIGHTEN_INSTRUCTION);
    const tightenCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: tightenPrompt.system,
      prompt: tightenPrompt.user,
      temperature: settings.temperature.generate,
      maxTokens: MAX_TOKENS,
    });
    if (tightenCall.ok) {
      const tightened = autoFix(tightenCall.text, fixOptions);
      const tightenedCheck = checkExclusions(tightened.text, settings);
      finalText = tightened.text;
      appliedAutoFixes = [...appliedAutoFixes, ...tightened.appliedFixes];
      residualViolations = tightenedCheck.violations;
      wasRepaired = true;
      calls.push({
        label: `tighten (${String(overLength)} → target ≤280)`,
        ...tightenPrompt,
      });
    }
    // Tighten failed → user sees the over-limit draft and the gate
    // surface in the panel will warn them.
  }

  await setLastPrompt({
    timestamp: Date.now(),
    mode,
    calls,
    response: finalText,
    wasRepaired,
  });

  return {
    ok: true,
    draft: { posts: [{ text: finalText, characterCount: weightedLength(finalText) }] },
    appliedAutoFixes,
    residualViolations,
    wasRepaired,
  };
}
