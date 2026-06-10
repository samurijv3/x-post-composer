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
 * Refine reshapes whatever draft the panel sends.
 */
import { getAllItems, getApiKey, getSettings, setLastPrompt } from '../../src/storage';
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
  escalateChipInstruction,
  renderTemplate,
  splitPrompt,
  summarizeViolations,
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

  const initialPrompt = assembleInitialPrompt(request, settings, examples);
  const temperature = request.isRegenerate
    ? settings.temperature.regenerate
    : settings.temperature.generate;

  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    charCap: request.charCap,
    initialPrompt,
    temperature,
  });
}

// ---------------------------------------------------------------------
// Refine entry — assembles a refine prompt (chip or more/less) then
// runs the same post-processing pipeline.
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
  let initialPrompt: string;
  if (kind.type === 'chip') {
    const chip = settings.chips.find((c) => c.id === kind.chipId);
    if (!chip) {
      return {
        ok: false,
        kind: 'bad-request',
        message: `Chip "${kind.chipId}" not found in current settings.`,
      };
    }
    const instruction = escalateChipInstruction(chip.instruction, kind.intensity);
    initialPrompt = renderTemplate(settings.promptTemplates.chipRefine, {
      instruction,
      previousDraft: request.previousDraftText,
    });
  } else {
    const more = kind.more.trim();
    const less = kind.less.trim();
    if (more === '' && less === '') {
      return {
        ok: false,
        kind: 'bad-request',
        message: 'more/less are both empty — nothing to refine on.',
      };
    }
    initialPrompt = renderTemplate(settings.promptTemplates.moreLessRefine, {
      more: more === '' ? '(none)' : more,
      less: less === '' ? '(none)' : less,
      previousDraft: request.previousDraftText,
    });
  }

  return runPipeline({
    apiKey,
    settings,
    mode: request.mode,
    charCap: request.charCap,
    initialPrompt,
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
  initialPrompt: string;
  temperature: number;
}

async function runPipeline(opts: PipelineOptions): Promise<GenerationResult> {
  const { apiKey, settings, mode, charCap, initialPrompt, temperature } = opts;
  const fixOptions = {
    fixEmDash: settings.structuralRules.noEmDash,
    fixSmartQuotes: settings.structuralRules.noSmartQuotes,
  };

  // Split at the `===USER===` marker. Generation templates put stable
  // framing (voice guide, exclusions, char rules) above the marker so
  // it is sent as a system message; refine + repair templates omit the
  // marker and go entirely as a single user message.
  const firstSplit = splitPrompt(initialPrompt);
  const firstCall = await callAnthropic({
    apiKey,
    model: settings.model,
    system: firstSplit.system,
    prompt: firstSplit.user,
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
  const promptChain: string[] = [initialPrompt];
  const repairLabels: string[] = [];

  if (hasRepairableViolations(firstCheck)) {
    const violationsSummary = summarizeViolations(firstCheck.violations);
    const repairPrompt = renderTemplate(settings.promptTemplates.repair, {
      violations: violationsSummary,
      previousDraft: firstFixed.text,
    });

    const repairSplit = splitPrompt(repairPrompt);
    const repairCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: repairSplit.system,
      prompt: repairSplit.user,
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
      promptChain.push(repairPrompt);
      repairLabels.push(`exclusion repair (${violationsSummary.replace(/\n/g, ' · ')})`);
    }
    // Repair call failed → keep first draft so the user still sees
    // something. Don't loop.
  }

  if (charCap && isOver280(finalText)) {
    const tightenPrompt = renderTemplate(settings.promptTemplates.tighten, {
      previousDraft: finalText,
    });
    const tightenSplit = splitPrompt(tightenPrompt);
    const tightenCall = await callAnthropic({
      apiKey,
      model: settings.model,
      system: tightenSplit.system,
      prompt: tightenSplit.user,
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
      promptChain.push(tightenPrompt);
      repairLabels.push(`tighten (${String(weightedLength(firstFixed.text))} → target ≤280)`);
    }
    // Tighten failed → user sees the over-limit draft and the gate
    // surface in the panel will warn them.
  }

  await setLastPrompt({
    timestamp: Date.now(),
    mode,
    prompt: promptChain.join('\n\n--- NEXT CALL ---\n\n'),
    response: finalText,
    wasRepaired,
    ...(repairLabels.length === 0 ? {} : { repairContext: repairLabels.join('\n') }),
  });

  return {
    ok: true,
    draft: { posts: [{ text: finalText, characterCount: weightedLength(finalText) }] },
    appliedAutoFixes,
    residualViolations,
    wasRepaired,
  };
}
