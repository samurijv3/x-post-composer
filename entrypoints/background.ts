/**
 * Background service worker.
 *
 * Responsibilities (CLAUDE.md §6):
 *   - Sole reader of the API key.
 *   - Sole caller of `api.anthropic.com`.
 *   - Routes typed messages between the side panel, content scripts,
 *     and the Anthropic client.
 *
 * Pipeline shape (Chunk 3 → 4):
 *   Generate:  sample → assemble → CALL → autoFix → exclusionRepair?
 *              → tightenRepair? → persistLastPrompt → reply
 *   Refine:    assemble → CALL → autoFix → exclusionRepair?
 *              → tightenRepair? → persistLastPrompt → reply
 *
 * Only Generate touches the example pool (re-runs selectExamples).
 * Refine reshapes whatever draft the panel sends.
 */
import { defineBackground } from 'wxt/utils/define-background';
import {
  broadcastNotice,
  isMessageOfType,
  onMessage,
  type BackgroundReply,
  type BackgroundToContent,
} from '../src/messaging';
import {
  addItem,
  getAllItems,
  getApiKey,
  getCaptureMode,
  getReplyContextLock,
  getSettings,
  setLastPrompt,
  setReplyContextLock,
} from '../src/storage';
import type {
  GenerationRequest,
  GenerationResult,
  LibraryItem,
  RawCapture,
  RefineRequest,
  ReplyContext,
  Settings,
} from '../src/types';
import { classifyType, validateAuthor } from '../src/lib/voice';
import { selectExamples } from '../src/lib/sampling';
import { autoFix, checkExclusions, hasRepairableViolations, type Span } from '../src/lib/exclusion';
import {
  buildCharConstraintInstruction,
  buildExclusionInstructions,
  buildParentSection,
  formatExamples,
  renderTemplate,
  splitPrompt,
} from '../src/lib/prompt';
import { isOver280, weightedLength } from '../src/lib/counting';
import { callAnthropic, verifyKey } from '../src/api/anthropic';

const MAX_TOKENS = 1024;
const X_HOSTS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*',
];

const AUTO_REPLY_FLAG = 'autoReplyCapture:v1';

/**
 * Set of currently-connected panel ports. The panel opens a port via
 * `chrome.runtime.connect({ name: 'margin-panel' })` on mount, and the
 * port closes automatically when the panel context is destroyed
 * (closed by the user, tab closed, etc.). We track the count so the
 * content script can suppress all overlays when no panel is open —
 * the highlight only makes sense when the user is actively in the
 * extension's UI.
 */
const openPanelPorts = new Set<chrome.runtime.Port>();

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('Failed to set side panel behavior', error);
  });

  // Keyboard shortcut: open the panel + auto-capture the reply context.
  // A storage flag covers the "panel not open yet" case; a broadcast
  // covers "panel already open." Both paths converge in the Composer.
  chrome.commands.onCommand.addListener((command, senderTab) => {
    if (command !== 'capture-reply-and-open') return;
    void handleAutoReplyCommand(senderTab);
  });

  // Panel-open tracking — see the comment on openPanelPorts.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'margin-panel') return;
    const wasOpen = openPanelPorts.size > 0;
    openPanelPorts.add(port);
    if (!wasOpen) void pushToTabs({ type: 'bg:panel-state', isOpen: true });
    port.onDisconnect.addListener(() => {
      openPanelPorts.delete(port);
      if (openPanelPorts.size === 0) {
        void pushToTabs({ type: 'bg:panel-state', isOpen: false });
      }
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;

    const modeChange = changes['activeCaptureMode:v1'];
    if (modeChange) {
      const next = modeChange.newValue;
      const mode = next === 'library' || next === 'reply-context' ? next : 'none';
      void pushToTabs({ type: 'bg:capture-mode-state', mode });
    }

    const lockChange = changes['replyContextLock:v1'];
    if (lockChange) {
      const lock = (lockChange.newValue as ReplyContext | undefined) ?? null;
      void pushToTabs({ type: 'bg:reply-context-lock-state', lock });
    }
  });

  onMessage(async (message) => {
    if (isMessageOfType(message, 'panel:ping')) {
      return { type: 'bg:pong', receivedAt: Date.now() };
    }

    if (isMessageOfType(message, 'panel:verify-key')) {
      const settings = await getSettings();
      const apiKey = await getApiKey(settings.keyStorageMode);
      const result = await verifyKey(apiKey, settings.model);
      return result.ok
        ? { type: 'bg:verify-key-result', ok: true, message: 'Key works.' }
        : { type: 'bg:verify-key-result', ok: false, message: result.message };
    }

    if (isMessageOfType(message, 'panel:add-manual-item')) {
      return handleManualAdd(message.text, message.itemType);
    }

    if (isMessageOfType(message, 'content:captured-tweet')) {
      await handleCapturedTweet(message.payload);
      return { type: 'bg:capture-ack', ok: true };
    }

    if (isMessageOfType(message, 'content:capture-failed')) {
      const kind = failureReasonToSaveResultKind(message.reason);
      if (kind) {
        await broadcastNotice({ type: 'bg:save-result', kind });
      }
      return { type: 'bg:capture-ack', ok: false };
    }

    if (isMessageOfType(message, 'content:reply-context-failed')) {
      await broadcastNotice({
        type: 'bg:reply-context-error',
        kind: replyContextFailureKind(message.reason),
      });
      return { type: 'bg:capture-ack', ok: false };
    }

    if (isMessageOfType(message, 'content:check-capture-mode')) {
      const mode = await getCaptureMode();
      return { type: 'bg:capture-mode-state', mode };
    }

    if (isMessageOfType(message, 'content:check-reply-context-lock')) {
      const lock = await getReplyContextLock();
      return { type: 'bg:reply-context-lock-state', lock };
    }

    if (isMessageOfType(message, 'content:check-panel-state')) {
      return { type: 'bg:panel-state', isOpen: openPanelPorts.size > 0 };
    }

    if (isMessageOfType(message, 'content:reply-context-selected')) {
      // The content script has already extracted target + grandparent +
      // status id. Persist as the active lock. Reply-context mode stays
      // ON deliberately so the user can hover other tweets and click
      // to swap the locked context without re-toggling the mode. They
      // turn it off in the panel when done.
      await setReplyContextLock(message.context);
      return { type: 'bg:reply-context-lock-state', lock: message.context };
    }

    if (isMessageOfType(message, 'content:dismiss-reply-context')) {
      await setReplyContextLock(null);
      return { type: 'bg:reply-context-lock-state', lock: null };
    }

    if (isMessageOfType(message, 'panel:generate')) {
      const result = await runGeneration(message.request);
      return { type: 'bg:generation-result', result };
    }

    if (isMessageOfType(message, 'panel:refine')) {
      const result = await runRefine(message.request);
      return { type: 'bg:generation-result', result };
    }

    if (isMessageOfType(message, 'panel:capture-reply-context')) {
      return await requestReplyContextFromActiveTab();
    }

    return undefined;
  });
});

// ---------------------------------------------------------------------
// Generation entry — picks the example pool, builds the initial prompt,
// then hands off to the shared post-processing pipeline.
// ---------------------------------------------------------------------

async function runGeneration(request: GenerationRequest): Promise<GenerationResult> {
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

async function runRefine(request: RefineRequest): Promise<GenerationResult> {
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
  // it can be sent as a cached system message; refine + repair
  // templates omit the marker and go entirely as a single user message.
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

function assembleInitialPrompt(
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

function summarizeViolations(violations: Span[]): string {
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

// ---------------------------------------------------------------------
// Keyboard shortcut handler
// ---------------------------------------------------------------------

async function handleAutoReplyCommand(senderTab: chrome.tabs.Tab | undefined): Promise<void> {
  let tab = senderTab;
  if (!tab?.id) {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active[0];
  }
  if (!tab?.id) return;

  await chrome.storage.session.set({ [AUTO_REPLY_FLAG]: Date.now() });

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    // Some Chrome versions reject `open` outside a tight user-gesture
    // window; the user can fall back to the toolbar icon. Don't throw.
    console.error('Side panel open from shortcut failed', error);
  }

  // The broadcast covers the case where the panel is already open and
  // would otherwise miss the flag (it's checked on mount only).
  await broadcastNotice({ type: 'bg:auto-reply-capture', at: Date.now() });
}

// ---------------------------------------------------------------------
// Reply-context capture (background → content script)
// ---------------------------------------------------------------------

async function requestReplyContextFromActiveTab(): Promise<BackgroundReply> {
  const tab = await findActiveXTab();
  if (!tab?.id) {
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message: 'No x.com tab is open in this window.',
    };
  }
  try {
    const raw: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: 'bg:capture-reply-context-request',
    } satisfies BackgroundToContent);
    if (isReplyContextOk(raw)) {
      return { type: 'bg:reply-context-result', ok: true, context: raw.context };
    }
    if (isReplyContextErr(raw)) {
      return { type: 'bg:reply-context-result', ok: false, message: raw.message };
    }
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message: 'Content script returned an unexpected shape.',
    };
  } catch (error) {
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message:
        error instanceof Error
          ? `Could not reach the x.com tab: ${error.message}`
          : 'Could not reach the x.com tab.',
    };
  }
}

async function findActiveXTab(): Promise<chrome.tabs.Tab | undefined> {
  const active = await chrome.tabs.query({
    url: X_HOSTS,
    active: true,
    currentWindow: true,
  });
  if (active[0]) return active[0];
  const any = await chrome.tabs.query({ url: X_HOSTS });
  return any[0];
}

function isReplyContextOk(raw: unknown): raw is { ok: true; context: ReplyContext } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { ok?: unknown }).ok === true &&
    typeof (raw as { context?: unknown }).context === 'object'
  );
}

function isReplyContextErr(raw: unknown): raw is { ok: false; message: string } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { ok?: unknown }).ok === false &&
    typeof (raw as { message?: unknown }).message === 'string'
  );
}

// ---------------------------------------------------------------------
// Library capture (carried forward from Chunk 2)
// ---------------------------------------------------------------------

async function handleCapturedTweet(capture: RawCapture): Promise<void> {
  // Every capture attempt — success or failure — focuses the Voice
  // screen so the user always lands where the save-result banner shows.
  await broadcastNotice({ type: 'bg:focus-voice' });

  const settings = await getSettings();
  if (settings.handle.trim() === '') {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'not-mine',
      rejectedAuthor: capture.authorHandle,
    });
    return;
  }

  if (!validateAuthor(capture.authorHandle, settings.handle)) {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'not-mine',
      rejectedAuthor: capture.authorHandle,
    });
    return;
  }

  const itemType = classifyType({
    hasReplyContextNode: capture.hasReplyContextNode,
    inReplyToStatusId: capture.inReplyToStatusId,
    isPrecededByParentArticle: capture.isPrecededByParentArticle,
  });

  const item: LibraryItem = {
    id: capture.statusId ?? crypto.randomUUID(),
    text: capture.text,
    type: itemType,
    source: 'capture',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    authorDisplayName: capture.authorDisplayName,
    authorAvatarUrl: capture.authorAvatarUrl,
    timestamp: capture.timestamp ?? new Date().toISOString(),
    engagement: null,
    embedding: null,
    createdAt: Date.now(),
  };

  const outcome = await tryAddItem(item);
  if (outcome === 'duplicate') {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: item.id,
    });
    return;
  }

  await broadcastNotice({
    type: 'bg:save-result',
    kind: capture.hasMedia ? 'text-media' : 'success',
    itemId: item.id,
    itemType,
  });
  await broadcastNotice({ type: 'bg:library-changed' });
}

async function handleManualAdd(text: string, itemType: 'post' | 'reply'): Promise<BackgroundReply> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { type: 'bg:add-manual-result', ok: false, message: 'Text is empty.' };
  }
  const settings = await getSettings();
  if (settings.handle.trim() === '') {
    return {
      type: 'bg:add-manual-result',
      ok: false,
      message: 'Set your X handle in the Account tab before adding items.',
    };
  }
  const item: LibraryItem = {
    id: crypto.randomUUID(),
    text: trimmed,
    type: itemType,
    source: 'manual',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    // Manual paste has no DOM source for these — the row renders without
    // an avatar and shows the handle only.
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: new Date().toISOString(),
    engagement: null,
    embedding: null,
    createdAt: Date.now(),
  };
  await addItem(item);
  await broadcastNotice({ type: 'bg:library-changed' });
  return {
    type: 'bg:add-manual-result',
    ok: true,
    message: 'Added.',
    itemId: item.id,
  };
}

async function tryAddItem(item: LibraryItem): Promise<'added' | 'duplicate'> {
  try {
    await addItem(item);
    return 'added';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') {
      return 'duplicate';
    }
    throw error;
  }
}

type SaveResultKind =
  | 'success'
  | 'text-media'
  | 'duplicate'
  | 'not-mine'
  | 'truncated'
  | 'media-only';

/**
 * Map a content-script failure reason onto a save-result banner kind.
 * `missing-text` / `missing-author` / `unknown` / `no-tweet-under-cursor`
 * don't map to any banner — they're edge cases the user can't really
 * act on, so we stay silent rather than surfacing a useless message.
 */
function failureReasonToSaveResultKind(reason: string): SaveResultKind | null {
  if (reason === 'truncated') return 'truncated';
  if (reason === 'media-only') return 'media-only';
  return null;
}

/**
 * Reply-context-mode failures share kinds with save-result so the panel
 * can render reply-context-flavoured wording in the same banner chrome.
 */
function replyContextFailureKind(reason: string): 'truncated' | 'media-only' | 'unknown' {
  if (reason === 'truncated') return 'truncated';
  if (reason === 'media-only') return 'media-only';
  return 'unknown';
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
function escalateChipInstruction(instruction: string, intensity: number): string {
  if (intensity <= 1) return instruction;
  if (intensity === 2) {
    return `${instruction}\n\nThis is the second press of the same chip — push noticeably harder than a single pass would. The previous draft is already the result of one application; this one should go further.`;
  }
  if (intensity === 3) {
    return `${instruction}\n\nThis is the third press of the same chip. The user has now asked for this direction three times. Apply the instruction dramatically — the result should be unmistakably more in this direction than the previous draft.`;
  }
  return `${instruction}\n\nThis is press #${String(intensity)} of the same chip. The user has repeatedly asked for this direction. Apply MAXIMUM intensity — don't be subtle. The result should be a clear, undeniable step in this direction beyond what the previous draft showed.`;
}

// ---------------------------------------------------------------------
// Tab broadcast helper
// ---------------------------------------------------------------------

async function pushToTabs(message: BackgroundToContent): Promise<void> {
  const tabs = await chrome.tabs.query({ url: X_HOSTS });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Content script not present in this tab. Ignore.
      }
    }),
  );
}
