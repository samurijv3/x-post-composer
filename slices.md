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
3. `content:reply-context-selected` → background folds the selection through `mergeReplyContextSelection` (`src/lib/replyContext`) — a re-delivery of the **same tweet** (X's modal copies carry no author/status links) enriches the existing lock instead of degrading it; a different tweet swaps — then persists via `setReplyContextLock` and replies with the lock state. The content script also affirms the clicked article as the highlight target immediately (modal copies can't be re-found by status id). **Mode stays on** — next click swaps the lock. Failures → `content:reply-context-failed` → `bg:reply-context-error` → `ReplyContextErrorBanner`. The shortcut path (slice 4) applies the same merge before its `setReplyContextLock`.
4. Storage change → push to all tabs; content paints the lock overlay on the locked tweet's article (rAF-repositioned, re-scan throttled to 200 ms); panel `ComposeScreen` (subscribed to the lock) shows `ReplyContextCard`; `hasContext` flips generation to reply mode. The highlight yields to X's own UI state: while an `aria-modal` layer is open, overlays paint only on the modal's own content (preview follows modal-resident tweets; the lock search is scoped to the modal layer) and never over the scrim. The lock highlight attaches to **the locked tweet itself wherever the active layer renders it** — the search tries the status id (`findArticleByStatusId`, dialog copies skipped in page scope), then text identity (`findArticleByTweetText`, normalized via the merge's `normalizeTweetText`; truncation-gated prefix match covers re-collapsed copies) — so it follows the lock into a modal, back out on close, vanishes on views that don't render the tweet, and reappears on views that do (§6 as clarified 2026-06-11; there is deliberately no path anchoring — see the Build Decisions Log). The lock and card persist throughout. Policy: `lib/overlay` `decideOverlayVisibility`.
5. Clearing: card's × (panel writes the lock key directly) or the overlay dismiss button (optimistic local hide, then `content:dismiss-reply-context` → background writes the same key). **The storage write is the convergence point** — every surface reacts to the same `replyContextLock:v1` change, so both gestures end in the identical state; the optimistic hide gives the × the trashcan's instant feel and keeps it working in an orphaned content script. Banner toggle off hides the highlight only (lock persists).

## 4. Reply context via keyboard shortcut (Alt-Shift-R)

1. `chrome.commands` → background `index.ts handleAutoReplyCommand`: `sidePanel.open()` **first** (gesture rule), then `setAutoReplyFlag(at)` + `broadcastNotice({type:'bg:auto-reply-capture', at})` — same stamp.
2. Panel `ComposeScreen` effect: consumes the flag on mount (stale > 15 s ignored) AND listens for the notice; `lastShortcutAt` ref dedupes the pair.
3. Either path → `sendToBackground({type:'panel:capture-reply-context'})` → `tabs.requestReplyContextFromActiveTab` → content `bg:capture-reply-context-request` → `extractReplyContextFromComposer` (`extract.ts` — the article(s) above X's open reply box) → reply → panel `setReplyContextLock(context)`; errors → toast.

## 5. Generate a draft

Trigger: Compose → bullets → Generate (or ⌘↵), or Regenerate.

1. `ComposeScreen.generate()`: resets refine state, builds `GenerationRequest{mode: hasContext?'reply':'post', bullets, charCap, replyContext, isRegenerate, bulletedInput}`, bumps `requestSeq` (latest-call-wins). Bullets are detected from typing, never toggled: a line opened `- ` or `* ` converts to a real `•` as typed (keystroke interception; `normalizeTypedBullets` covers paste), Enter continues the list (empty bullet ends it; Shift+Enter escapes), and any bullet line present sets `bulletedInput` — the explicit fragments signal that overrides the intent-shape heuristic in `assembleInitialPrompt`.
2. `panel:generate` → `generation.ts runGeneration`: key guard → `getAllItems` → `selectExamples(mode, ctx, library, {poolSize})` → `assembleInitialPrompt(request, settings, {voice: examples, aspirational: []})` → `{system, user}` → `runPipeline`.
3. `runPipeline` (see the diagram in `architecture.md`): `callAnthropic {system, prompt: user}` (temperature: regenerate vs generate) → empty-text guard → `autoFix` → `checkExclusions` → if violations, ONE repair call (`summarizeViolations` → `buildRepairInstruction` → `assembleRefinePrompt`) → if `charCap && isOver280`, ONE tighten call (`TIGHTEN_INSTRUCTION` → `assembleRefinePrompt`) → `setLastPrompt` (labelled per-call records) → `GenerationResult{draft.posts[{text, characterCount}], appliedAutoFixes, residualViolations, wasRepaired}`.
4. Panel `applyResult` dispatches into the draft lifecycle (slice 11): errors → `generation-failed` + `compose/ErrorCard`; success → `generation-succeeded` (stale seqs ignored by the reducer) → `compose/DraftState` renders the editable `DraftEditor` (highlight backdrop while violations remain), weighted count, over-cap warning. A generate landing over an existing draft opens the timed-undo window.

A new pipeline stage goes in `runPipeline` with its pure logic in `src/lib/`; a new prompt input is a template slot + `assembleInitialPrompt` entry + tests in `assemble.test.ts`.

## 6. Refine a draft (chips, freeform, polish, refit, undo)

Every refinement is one `panel:refine` through the single refine template with its full voice anchor (Phase 1); none resample the example pool.

1. Entry points → `RefineKind`: **chip** tap (`applyChip` — snapshots for Undo, bumps the per-chip counter for escalating `intensity`), the **freeform box** (`applySteer` — typed feedback sent verbatim as the instruction), the **Polish** button (`{type:'polish'}` — code-supplied `POLISH_INSTRUCTION`: tighten phrasing, preserve meaning/stance/length), and the **≤280 toggle flipped ON over an over-limit active draft** (`{type:'refit'}` — `REFIT_INSTRUCTION`: content is the fixed point, only length changes; toast says "same draft, shorter"; flipping OFF or toggling pre-draft never touches text; an under-280 draft isn't refitted).
2. `generation.ts runRefine`: chip looked up in **current settings** (live edits count) → `escalateChipInstruction`; freeform/polish/refit map to their instructions; inspector labels: `refine (chip: …)` / `(freeform)` / `(polish)` / `(refit to ≤280)` → `assembleRefinePrompt` → same `runPipeline`.
3. Undo restores the one-level `refineSnapshot` (covers all four kinds; survives hand edits). Regenerate ends the refine chain and replaces under the timed undo (slice 11).

New refine affordances: add a `RefineKind` variant in `types/generation.ts`, map it to an instruction in `runRefine`, keep any text-shaping pure in `src/lib`.

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

Panel mounts → `margin-panel` port + 20 s heartbeat (+ reconnect) → background `openPanelPorts` 0↔n transitions push `bg:panel-state` → content mirrors `panelOpen`, re-validating on `visibilitychange` + every 30 s while open (the lease). An **orphaned** script (extension reloaded under the page) tears all overlays down and goes inert the moment any `isAlive` probe fails — a page reload brings the fresh script. `applyOverlayState()` applies the single render decision — the pure `decideOverlayVisibility` (`src/lib/overlay`): nothing paints unless `panelOpen`; while X has an `aria-modal` layer open (probed on the 200 ms rAF throttle) overlays are scoped to the modal's content only; the lock highlight additionally requires reply-context mode and attaches only to the locked tweet itself, found by id or text identity in the active layer (no path anchoring; pathname changes just trigger a prompt refresh). Touch this slice only with `architecture.md`'s MV3 facts in hand.

## 10. Off-X awareness (panel "go back to X" overlay)

1. Background `index.ts`: `tabs.onActivated` + `tabs.onUpdated` (active tab, url/status changes only) → `pushActiveTabState()` → broadcast `bg:active-tab-state {onX}` — only while a panel port is open. `tabs.ts isActiveTabOnX` decides via `isXPageUrl` (`src/lib/url`); no "tabs" permission, so non-X URLs are invisible to us and read as `onX: false` by construction.
2. Panel `App.tsx`: seeds with `panel:check-active-tab` on mount, then follows the notices. `onX === false` → translucent `.offx-overlay` veil over the panel with two actions: **Open x.com** (`panel:open-x-tab` → `focusOrOpenXTab` — focus an existing X tab, else open one) and **Compose anyway** (dismisses for this off-X stint; returning to X re-arms it).
3. The options page never shows the overlay (it's `PanelShell`-only).

## 11. The draft lifecycle (direct editing, two undo scopes, commit)

The state machine is `lib/draft` `reduceDraftLifecycle` (pure, tested): **empty → generating → active → committed**. `ComposeScreen` composes it via `useReducer` and only dispatches events; the reducer is the single authority on transitions, including the stale-request gate (only the newest `seq` may land — a slow earlier generation can never flip a newer draft back).

1. **Direct editing**: the draft renders in `compose/DraftEditor` — a real textarea (type/delete/paste in place; pasting a finished draft to refine it IS the dump-a-draft mode). While residual violations exist, a metrics-identical backdrop paints highlight marks behind the glyphs. The first hand edit dispatches `hand-edited`: violations clear for good, the content is marked `handEdited`, and **nothing ever re-checks user text** (hand edits bypass exclusions; only later model output carries fresh violations). Hand edits ride into refines (`previousDraftText` is the current text) and through commit.
2. **Two undo scopes, coexisting**: the **timed undo** (~5 s, `replaced` snapshot + the panel's single timer → `replacement-expired`) guards REPLACEMENT — a generate landing over an existing draft, or a new context clearing one; the toast offers Undo, never a modal; touching the new draft (hand edit / refine) adopts it. The **one-level refine undo** (`refineSnapshot`) is unchanged from before and survives hand edits. The timed snapshot is in-panel state only — a panel close during the window means the replacement stands.
3. **New context** = a lock arriving for a different tweet than the immediately-previous lock (same-tweet re-deliveries are enrichments; clearing the lock is not new context). It empties the whole workbench — the draft, the angle text, and the previous lock itself are snapshotted together, and one timed Undo restores all three exactly as they were (the lock restore is suppressed from re-reading as another new context) — and invalidates any in-flight generation, whose result was for the old context. (An angle typed with no draft yet is never touched: clearing only fires when a draft was actually live.)
4. **Commit**: Copy to X (button or Ctrl+Shift+Enter, panel-scoped — macOS Chrome never delivers ⌘⇧↵ to the panel, field-verified) copies the exact current text, flips the lifecycle to `committed` (resolving both undo scopes), and fires the SEPARATE corpus event — `lib/draft` `emitDraftCommit` — which nothing consumes in v1; Phase 4's shipped-tweet loop subscribes via `onDraftCommit`. Lifecycle "done" and corpus "done" are deliberately distinct facts. Editing a committed draft re-opens it (`active`); the `copied` badge drops.

Next-session affordances (refit, polish pass, freeform box, Longer chip, bulleted input) slot in as new events/dispatch sites on this reducer — keep its seams.
