# slices.md — feature slices, traced end to end

Each slice lists the exact path a behavior takes through the surfaces. Reason about (and modify) the system one slice at a time; the last line of each slice says where new work of that kind slots in. Module contracts: `components.md`. Structure: `architecture.md`.

## 1. Capture a tweet to the voice library

Trigger: Voice screen → CaptureBanner toggle on → user clicks one of their tweets on x.com.

1. `voice/CaptureBanner.tsx` → `setCaptureMode('library')` (storage.session).
2. Background `index.ts` storage listener → `pushToTabs({type:'bg:capture-mode-state'})`; content `index.ts` mirrors `captureMode`; hover paints the preview overlay (`overlay.setPreview`) — only while `panelOpen`.
3. Capture-phase click listener (`twitter.content/index.ts`): ignores clicks on interactive children / our overlay; otherwise `preventDefault` → `runLibraryCapture(article)`.
4. `isTweetTruncated` gate → `extractTweet(article)` (`extract.ts`) → `RawCapture` or a failure tag.
5. `sendOneWay({type:'content:captured-tweet', payload})` (failures: `content:capture-failed` + reason).
6. Background `capture.ts handleCapturedTweet`: empty/mismatched handle → `bg:save-result kind:'not-mine'`; else `classifyType` (lib/voice) → `LibraryItem` (id = statusId ?? uuid, `embedding: null`) → `addItem`; duplicate id (`ConstraintError`) → `kind:'duplicate'`; success → `kind: hasMedia ? 'text-media' : 'success'` + `bg:library-changed`. Failure reasons map via `failureReasonToSaveResultKind` (only `no-tweet-under-cursor` is silent).
7. Panel `App.tsx onNotice` → floating `SaveResultBanner`; success also flashes the new row (`flashRow {id, kind:'added'}` → `voice/LibRow`). A duplicate's **Show me** CTA switches to Voice, widens the type filter to All if it would hide the row, scrolls the row into view, and flashes it (`kind:'dup'` → `flash-dup` style). `VoiceScreen` refreshes on `bg:library-changed`.

New capture-quality logic (e.g. screening hints) slots into step 6, as pure predicates from `lib/screening` called in `capture.ts`.

## 2. Add an example manually

Voice → `+` → `voice/AddForm.tsx` (text + type + "this is my own writing" gate) → `sendToBackground({type:'panel:add-manual-item'})` → `capture.ts handleManualAdd` (empty-text / no-handle guards; **no** validateAuthor — the checkbox is the authorship gate here) → `addItem` → `bg:library-changed` → list refresh.

## 3. Pull in reply context (click-to-select)

Trigger: Compose → ReplyContextBanner toggle → click a tweet.

1. `compose/ReplyContextBanner` → `setCaptureMode('reply-context')`; same push/mirror as slice 1 step 2.
2. Click → `runReplyContextSelect(article)`: truncation gate → `extractReplyContextFromArticle` (`extract.ts`) — target text + grandparent (only on `/status/` or `/with_replies` pages; `findGrandparentArticle` refuses to guess on feeds) + `hadUnreadableMedia`.
3. `content:reply-context-selected` → background persists via `setReplyContextLock` and replies with the lock state. **Mode stays on** — next click swaps the lock. Failures → `content:reply-context-failed` → `bg:reply-context-error` → `ReplyContextErrorBanner`.
4. Storage change → push to all tabs; content paints the lock overlay on the matching article (`findArticleByStatusId` — dialog-resident copies skipped; rAF-repositioned, re-scan throttled to 200 ms); panel `ComposeScreen` (subscribed to the lock) shows `ReplyContextCard`; `hasContext` flips generation to reply mode. The highlight additionally yields to X's own UI state: it (and the preview) hide while an `aria-modal` layer is open, and SPA navigation suppresses it until the next user gesture — a new selection or re-engaging reply-context mode (§6; the lock and card persist). Policy: `lib/overlay` `decideOverlayVisibility`.
5. Clearing: card's × (panel writes the lock key directly) or the overlay dismiss button (optimistic local hide, then `content:dismiss-reply-context` → background writes the same key). **The storage write is the convergence point** — every surface reacts to the same `replyContextLock:v1` change, so both gestures end in the identical state; the optimistic hide gives the × the trashcan's instant feel and keeps it working in an orphaned content script. Banner toggle off hides the highlight only (lock persists).

## 4. Reply context via keyboard shortcut (Alt-Shift-R)

1. `chrome.commands` → background `index.ts handleAutoReplyCommand`: `sidePanel.open()` **first** (gesture rule), then `setAutoReplyFlag(at)` + `broadcastNotice({type:'bg:auto-reply-capture', at})` — same stamp.
2. Panel `ComposeScreen` effect: consumes the flag on mount (stale > 15 s ignored) AND listens for the notice; `lastShortcutAt` ref dedupes the pair.
3. Either path → `sendToBackground({type:'panel:capture-reply-context'})` → `tabs.requestReplyContextFromActiveTab` → content `bg:capture-reply-context-request` → `extractReplyContextFromComposer` (`extract.ts` — the article(s) above X's open reply box) → reply → panel `setReplyContextLock(context)`; errors → toast.

## 5. Generate a draft

Trigger: Compose → bullets → Generate (or ⌘↵), or Regenerate.

1. `ComposeScreen.generate()`: resets refine state, builds `GenerationRequest{mode: hasContext?'reply':'post', bullets, charCap, replyContext, isRegenerate}`, bumps `requestSeq` (latest-call-wins).
2. `panel:generate` → `generation.ts runGeneration`: key guard → `getAllItems` → `selectExamples(mode, ctx, library, {poolSize})` → `assembleInitialPrompt(request, settings, {voice: examples, aspirational: []})` → `{system, user}` → `runPipeline`.
3. `runPipeline` (see the diagram in `architecture.md`): `callAnthropic {system, prompt: user}` (temperature: regenerate vs generate) → empty-text guard → `autoFix` → `checkExclusions` → if violations, ONE repair call (`summarizeViolations` → `buildRepairInstruction` → `assembleRefinePrompt`) → if `charCap && isOver280`, ONE tighten call (`TIGHTEN_INSTRUCTION` → `assembleRefinePrompt`) → `setLastPrompt` (labelled per-call records) → `GenerationResult{draft.posts[{text, characterCount}], appliedAutoFixes, residualViolations, wasRepaired}`.
4. Panel `applyResult`: error kind → `compose/ErrorCard` copy; success → draft state; `compose/DraftState` renders `renderWithHighlights(text, residualViolations)`, weighted count, over-cap warning.

A new pipeline stage goes in `runPipeline` with its pure logic in `src/lib/`; a new prompt input is a template slot + `assembleInitialPrompt` entry + tests in `assemble.test.ts`.

## 6. Refine a draft (chips, more/less, undo)

1. Chip tap → `applyChip`: snapshots prev draft/violations for Undo, bumps the per-chip counter, sends `panel:refine {kind:{type:'chip', chipId, intensity}}`. More/less → `applySteer` (Apply button / ⌘↵) with `{type:'moreless', more, less}`.
2. `generation.ts runRefine`: chip looked up in **current settings** (so live edits count) → `escalateChipInstruction(instruction, intensity)`; more/less → `composeMoreLessInstruction(more, less)`. Either way, one instruction string → `assembleRefinePrompt(settings, previousDraftText, instruction)` — the single refine template, system voice anchor included → same `runPipeline` (no resampling).
3. Undo restores the snapshot (one level). Regenerate (slice 5 with `isRegenerate`) clears chip counts and steering.

New refine affordances: add a `RefineKind` variant in `types/generation.ts`, handle it in `runRefine`, keep any text-shaping in `lib/prompt/assemble.ts`.

## 7. Inspect the last prompt

`runPipeline` → `setLastPrompt` (session, `lastPrompt:v2` — structured `calls: {label, system, user}[]`) → `LastPromptInspector` (bottom of DraftState) subscribes and renders every call in the chain — label, System block, User block per call, final Response last — with copy buttons. No string splitting: the stored fields are exactly what was sent. Anything the pipeline sends must remain visible here — transparency is load-bearing (`design.md`).

## 8. Edit settings

All in the options page (`OptionsPage.tsx` → sections); the panel only reads.

- **Account**: handle (blur-save → capture filter). Key: write-only field — Save persists mode (+ key if pasted; blank keeps), Clear removes both areas, Verify → `panel:verify-key` → `runVerifyKey` (checks the SAVED key; button disabled while the input is dirty). Model id shown read-only.
- **Output rules**: structural toggles / pool slider / temperatures save immediately; banlist on blur. Consumed at generation time by `buildExclusionInstructions`, `selectExamples`, `checkExclusions`, `autoFix`.
- **Prompts**: `TemplateRow` (System/User bodies, each saved on blur; slot badges across both via `extractSlotNames`; reset to `DEFAULT_PROMPT_TEMPLATES[key]`); `ChipEditor` (text on blur, structure immediately).
- **Data**: export JSON (`EXPORT_SCHEMA_VERSION` + items), clear-all (single transaction, two-step confirm).
- **Theme**: toggle in both surfaces → `themePreference:v1` → `bindDocumentTheme` sets `<html data-theme>` everywhere.

New setting = field + default in `types/settings.ts` (merge handles old installs) → UI in the right section → consume where needed → cases in `config.test.ts`.

## 9. Panel-open overlay gating (cross-cutting)

Panel mounts → `margin-panel` port + 20 s heartbeat (+ reconnect) → background `openPanelPorts` 0↔n transitions push `bg:panel-state` → content mirrors `panelOpen`, re-validating on `visibilitychange` + every 30 s while open (the lease). `applyOverlayState()` applies the single render decision — the pure `decideOverlayVisibility` (`src/lib/overlay`): nothing paints unless `panelOpen`; nothing paints while X has an `aria-modal` layer open (probed on the 200 ms rAF throttle); the lock highlight additionally requires reply-context mode and no SPA navigation since the lock was last affirmed (pathname compared per frame). Touch this slice only with `architecture.md`'s MV3 facts in hand.
