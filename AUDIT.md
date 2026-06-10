# Codebase Audit — Phase 1 of the hardening pass

**Audited commit:** `2ef89b6` ("Added new features and full UI overhaul") on `main`, working tree clean.
**Date:** 2026-06-10.
**Method:** full read of every source file; independent re-verification of every CLAUDE.md §6 invariant by grep and built-bundle inspection; tooling run with captured results; framework-dependent findings verified against current docs (docs.claude.com model catalog & prompt-caching reference, Chrome extension service-worker lifecycle & sidePanel API docs, wxt.dev entrypoint docs) rather than memory.

Severity scale: **Critical** (exploitable / data-loss now) · **High** (real defect or systemic violation of the project's own rules) · **Medium** (concrete problem, bounded impact) · **Low** (small, cheap, still worth doing).
Effort scale: **XS** ≤ 30 min · **S** ≤ 2 h · **M** ≤ 1 day · **L** > 1 day.

**Severity counts: 0 Critical · 4 High · 10 Medium · 16 Low** (18 "Fix", 12 "Consider").

---

## Summary table

| ID       | Title                                                                                                          | Severity | Dimension                     | Type     |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | -------- |
| MV3-01   | Panel-liveness port has no keepalive or reconnect; breaks after SW idle-death                                  | High     | MV3 correctness               | Fix      |
| ARCH-01  | `lib/prompt/defaults.ts` exports dead, _divergent_ copies of the default prompts                               | High     | Architecture / transparency   | Fix      |
| ARCH-02  | Five files far over the ~200-line / one-responsibility rule                                                    | High     | Architecture                  | Fix      |
| ARCH-03  | Prompt-assembly "brain" logic lives untested in the shell, with duplicated copies in UI                        | High     | Architecture / tests          | Fix      |
| SEC-01   | `SECURITY-AUDIT.md` is stale: cites deleted files, predates the overlay carve-out                              | Medium   | Security (docs)               | Fix      |
| MV3-02   | `await` before `sidePanel.open()` risks consuming the user-gesture window                                      | Medium   | MV3 correctness               | Fix      |
| MV3-03   | Manifest has no icons (CWS blocker) and no `minimum_chrome_version`                                            | Medium   | Publishing                    | Fix      |
| API-01   | Prompt-caching comments/UI promise a discount that never materializes on the default model                     | Medium   | API / honesty                 | Fix      |
| TEST-01  | Load-bearing deterministic logic with zero tests: settings merge/migration, HTTP error mapping, DOM extraction | Medium   | Tests                         | Fix      |
| DOC-01   | README describes the pre-redesign product (flows, components, counts)                                          | Medium   | Docs                          | Fix      |
| QUAL-01  | Prettier fails on 43 files — violates the repo's own working agreement                                         | Medium   | Quality                       | Fix      |
| GIT-01   | History is two mega-commits; HEAD message violates Conventional Commits; everything straight to `main`         | Medium   | Git hygiene                   | Fix      |
| PERF-01  | Content-script rAF loop scans every tweet article on every frame while a lock is active                        | Medium   | Performance                   | Fix      |
| ARCH-04  | Dead code cluster: unused messages, exports, settings, and leftovers                                           | Low      | Architecture                  | Fix      |
| QUAL-02  | Stale / misleading comments (12 concrete instances itemized)                                                   | Low      | Comments                      | Fix      |
| PERF-02  | "Clear voice library" issues one IndexedDB transaction per item                                                | Low      | Performance                   | Fix      |
| UX-01    | "Verify" checks the _saved_ key while the UI implies it checks the typed key                                   | Low      | UX correctness                | Fix      |
| DOC-02   | Side-panel/options HTML titles still say "X Post Composer", product is "Margin"                                | Low      | Docs                          | Fix      |
| SEC-02   | Stored API key is read back into options-page React state/DOM on mount                                         | Medium   | Security posture              | Consider |
| SEC-03   | `Avatar` renders stored URLs without re-validating the `pbs.twimg.com` host                                    | Low      | Security (defense in depth)   | Consider |
| API-02   | `callAnthropic` fetch has no timeout                                                                           | Low      | API robustness                | Consider |
| MODEL-01 | Model is not user-visible/editable anywhere; `temperature` is always sent                                      | Low      | Transparency / forward-compat | Consider |
| ARCH-05  | `setSettings` read-merge-write can race across panel + options surfaces                                        | Low      | Architecture                  | Consider |
| UX-02    | Chip editor writes the whole settings record on every keystroke                                                | Low      | UX / perf                     | Consider |
| UX-03    | Some capture failures are deliberately silent (`missing-text`, `missing-author`, `unknown`)                    | Low      | UX                            | Consider |
| TEST-02  | `relativeTime` tests are timezone-sensitive                                                                    | Low      | Tests                         | Consider |
| REPO-01  | `.claude/` not in repo `.gitignore`; 2.6k-line design prototype committed at repo root                         | Low      | Repo hygiene                  | Consider |
| DATA-01  | Export payload says `schemaVersion: 1` while rows are DB-v2 shape                                              | Low      | Data                          | Consider |
| DEV-01   | ESLint runs the non-type-aware tier; promise discipline is manual                                              | Low      | Tooling                       | Consider |
| DEP-01   | `npm audit`: 8 vulnerabilities — all in the dev-only `wxt → web-ext-run` chain                                 | Low      | Supply chain                  | Consider |

---

## Phase 2 remediation log

Checked off as fixes land on `chore/codebase-hardening`. Deviations from the original proposal are noted inline on the finding.

- [x] MV3-01 · [x] ARCH-01 · [x] ARCH-02 · [x] ARCH-03
- [ ] SEC-01 · [x] MV3-02 · [x] MV3-03 · [x] API-01 · [x] TEST-01 · [ ] DOC-01 · [x] QUAL-01 · [ ] GIT-01 · [x] PERF-01
- [ ] ARCH-04 · [ ] QUAL-02 · [ ] PERF-02 · [ ] UX-01 · [ ] DOC-02
- [ ] SEC-02 · [ ] SEC-03 · [ ] API-02 · [ ] MODEL-01 · [ ] ARCH-05 · [ ] UX-02 · [ ] UX-03 · [ ] TEST-02 · [ ] REPO-01 · [ ] DATA-01 · [ ] DEV-01 · [ ] DEP-01

### New findings during Phase 2

- [x] **NEW-01 (High, Fix)** — _The keyboard shortcut's capture half was unwired._ The background set `autoReplyCapture:v1` and broadcast `bg:auto-reply-capture`, but no panel code consumed either — Alt-Shift-R only opened the panel; the documented "and start capturing reply context" behavior (manifest command description, README) silently did nothing. Phase 1 verified the background side but did not trace the panel-side consumer; surfaced while reordering the handler for MV3-02. Fixed during Phase 2 rather than deferred because the alternative — treating the background half as ARCH-04 dead code — would have deleted a documented feature: the panel now consumes the mount-time flag (stale after 15 s) and handles the broadcast, deduped by a shared timestamp, then runs the existing `panel:capture-reply-context` round-trip and sets the lock. Flag access moved behind `src/storage/autoReplyFlag.ts` per the storage-module pattern.

---

## Tooling results (run on this tree, not impressions)

| Check        | Command                                                               | Result                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint         | `npm run lint` (eslint)                                               | ✅ clean, exit 0                                                                                                                                                  |
| Types        | `npm run compile` (tsc --noEmit, strict + `noUncheckedIndexedAccess`) | ✅ clean, exit 0                                                                                                                                                  |
| Format       | `npm run format:check` (prettier)                                     | ❌ **fails — 43 files** (28 source files + design-handoff + markdown). See QUAL-01                                                                                |
| Tests        | `npx vitest run`                                                      | ✅ **135/135 passing, 13 files**, ~1.5 s                                                                                                                          |
| Coverage     | vitest `--coverage` (v8, cross-checked with istanbul)                 | See below                                                                                                                                                         |
| Build        | `npm run build` (wxt build, chrome-mv3)                               | ✅ clean, 495 kB total (panel chunk 339 kB = React)                                                                                                               |
| Audit (prod) | `npm audit --omit=dev`                                                | ✅ **0 vulnerabilities** (prod deps: react, react-dom, twitter-text)                                                                                              |
| Audit (all)  | `npm audit`                                                           | ❌ 8 vulnerabilities (3 critical, 3 high, 2 moderate) — **all dev-only**, in `wxt → web-ext-run → {shell-quote, tmp, node-notifier, uuid, fx-runner}`. See DEP-01 |

**Coverage** (no coverage provider is configured in the repo — `@vitest/coverage-v8` had to be installed ad hoc; consider adding it as a devDependency so coverage is runnable). Note: Vitest 4's text reporter **hides fully-covered files**, which makes the default table misleading — `lib/prompt`, `lib/screening`, and `lib/voice` are invisible because they sit at **100 %**. Actual picture across `src/` (UI excluded):

| Module                                     | Stmts     | Notes                                                           |
| ------------------------------------------ | --------- | --------------------------------------------------------------- |
| `lib/exclusion`                            | 96 %      | residual branches are defensive paths                           |
| `lib/prompt`, `lib/voice`, `lib/screening` | **100 %** | hidden by the v4 reporter                                       |
| `lib/sampling`, `lib/format`               | 100 %     |                                                                 |
| `lib/counting`                             | 57 %      | uncovered lines are the CJS/ESM fallback chain (39–45), fine    |
| `storage/corpus.ts`                        | 98 %      | includes a real v1→v2 migration test                            |
| `storage/config.ts`                        | **0 %**   | load-bearing merge + template migration — see TEST-01           |
| `storage/` (other chrome.\* wrappers)      | 0 %       | thin wrappers; acceptable per CLAUDE.md §5                      |
| `api/anthropic.ts`                         | **0 %**   | contains pure, testable logic — see TEST-01                     |
| `messaging/`                               | 0 %       | mostly thin wrapper; `onMessage` error conversion is borderline |
| `entrypoints/`                             | untested  | contains brain logic that shouldn't be there — see ARCH-03      |

---

# Fix findings

Clear defects or rule violations. Each is actionable without further investigation.

---

### MV3-01 — Panel-liveness port has no keepalive and no reconnect; the panel-open signal breaks after the first SW idle-shutdown

**Severity:** High · **Dimension:** MV3 correctness · **Effort:** S–M

**Location:** `entrypoints/sidepanel/main.tsx:19`, `entrypoints/background.ts:84–113`, `entrypoints/twitter.content.ts:65–71` (`panelOpen` state).

**What's wrong.** The panel opens one `chrome.runtime.connect({ name: 'margin-panel' })` port at module load and never touches it again ("No messages flow over this port — it's a presence signal only"). Per the current Chrome service-worker lifecycle docs, **an open port does not keep the worker alive — only _messages_ on a port reset the 30-second idle timer** ("Opening a port no longer resets the timers", Chrome 114+). So:

1. Panel open, user reads X for ~30 s without generating → the SW is terminated _with the panel still open_. `openPanelPorts` (in-memory, `background.ts:84`) evaporates; the port dies; the panel has no `onDisconnect` handler and never reconnects.
2. **Stale-false:** any x.com tab loaded _after_ this asks `content:check-panel-state` and is told `isOpen: false` while the panel is plainly open → hover-preview and lock-highlight overlays never render in that tab until the panel is reloaded.
3. **Stale-true (worse, violates the design's own invariant):** tabs that were already open keep `panelOpen === true`. If the user then closes the panel while the SW is dead, no disconnect event ever fires anywhere — those tabs **keep painting hover overlays on x.com with the panel closed**, defeating the "we never paint anything on x.com unless the user is in our UI" rule the code states at `twitter.content.ts:88–92`.

**Why it matters.** This is the core UX signal for the overlay system, and it silently degrades after 30 idle seconds — the most common state for a side panel. It also contradicts a stated behavioral invariant.

**Proposed fix.**

- Panel: send a tiny heartbeat over the port on an interval comfortably below 30 s (e.g. `setInterval(() => port.postMessage('hb'), 20_000)`). Port messages reset the SW idle timer, so this both keeps `openPanelPorts` truthful **and** keeps the SW alive exactly while the panel is open (cheap, bounded).
- Panel: add `port.onDisconnect` → reconnect with a short backoff (covers SW crash/update while panel open).
- Content script: treat `panelOpen` as a lease — re-issue `content:check-panel-state` on `visibilitychange` and/or every ~30 s while it believes the panel is open, so stale-true self-heals even if a push is missed.

---

### ARCH-01 — `src/lib/prompt/defaults.ts` exports dead, divergent copies of the default prompt templates

**Severity:** High · **Dimension:** Architecture / transparency · **Effort:** S

**Location:** `src/lib/prompt/defaults.ts:13–77` (`DEFAULT_REPLY_TEMPLATE`, `DEFAULT_POST_TEMPLATE`, `DEFAULT_REPAIR_TEMPLATE`) vs. `src/types/settings.ts:113–210` (`DEFAULT_SETTINGS.promptTemplates` — the live copy). Re-exported via `src/lib/prompt/index.ts:11–13`.

**What's wrong.** The default prompts exist twice, and the copies have **drifted**:

- The live templates (settings.ts) contain the `===USER===` system/user split marker; the dead ones don't.
- Section order differs (LENGTH above the marker vs. at the bottom).
- The dead module is missing `chipRefine`, `moreLessRefine`, and `tighten` entirely.
- Nothing in app code imports the three constants — only the barrel re-export. Even `defaults.test.ts` tests only the builder functions, not these constants.

**Why it matters.** This project's whole pitch is "the prompts are visible — read them." A contributor or auditor who opens `lib/prompt/defaults.ts` (the obvious place) reads **the wrong prompts**. That's worse than a normal DRY violation here; it's a transparency bug.

**Proposed fix.** Single source of truth. Move the _live_ template literals into `lib/prompt/defaults.ts` (the natural home — `types/` shouldn't carry ~100 lines of prompt copy), export one `DEFAULT_PROMPT_TEMPLATES: Record<PromptTemplateKey, PromptTemplate>`, and have `DEFAULT_SETTINGS` import it. Delete the three stale constants.

---

### ARCH-02 — Five files far over the ~200-line / one-responsibility rule

**Severity:** High · **Dimension:** Architecture · **Effort:** M–L (mechanical, no behavior change)

**Location & line counts:**

- `entrypoints/twitter.content.ts` — **983** lines, four separable jobs: state mirroring/messaging, hover+click routing, tweet/reply-context DOM extraction (~250 lines), overlay system + injected CSS (~270 lines).
- `src/ui/ComposeScreen.tsx` — **981** lines; `DraftState` takes **31 props** (`ComposeScreen.tsx:529–571`), a textbook prop-drilling smell.
- `entrypoints/background.ts` — **799** lines: message routing + generation/refine pipeline + prompt helpers + capture handling + tab broadcast.
- `src/ui/VoiceScreen.tsx` — 490 lines (screen + banner + row + add-form).
- `src/ui/sections/PromptsSection.tsx` — 315 lines (templates editor + chip editor).

**Why it matters.** CLAUDE.md §3 calls one giant file "the single biggest failure mode" and sets ~200 lines / one responsibility as the bar. The three biggest files in the repo are the three most consequential ones, which is exactly where the rule earns its keep. The content-script extraction logic being trapped in an entrypoint is also why it has zero tests (see TEST-01).

**Proposed fix.** Mechanical splits, no behavior change:

- Content script → `src/content/extraction.ts` (pure functions over `Element` — testable under happy-dom), `src/content/overlay.ts`, `src/content/state.ts`, with `entrypoints/twitter.content.ts` reduced to wiring (~150 lines).
- `background.ts` → keep routing in the entrypoint; move `runPipeline`/`runGeneration`/`runRefine` to e.g. `src/background/pipeline.ts` (or keep them but extract the pure helpers per ARCH-03); capture handling to its own module.
- `ComposeScreen.tsx` → `PreDraftState`, `DraftState`, `ReplyContextCard`, `ReplyContextBanner`, `ErrorCard` into `src/ui/compose/`; group the 31 props into 3–4 cohesive objects (`draftState`, `refineState`, `handlers`).
- `VoiceScreen` (LibRow, AddForm, CaptureBanner) and `PromptsSection` (ChipEditor) similarly.

---

### ARCH-03 — Brain logic lives untested in the shell; two UI components re-implement lib functions (one incorrectly)

**Severity:** High · **Dimension:** Architecture / tests · **Effort:** M

**Location:**

- `entrypoints/background.ts:464–490` `assembleInitialPrompt`, `:492–512` `summarizeViolations`, `:772–781` `escalateChipInstruction` — all three are pure prompt-assembly functions (CLAUDE.md §3 explicitly names prompt assembly as brain) living in an entrypoint with **no tests**.
- `src/ui/LastPromptInspector.tsx:37–44` — hand-rolled local `splitPrompt` duplicating `lib/prompt/template.ts:41–48`, including hardcoding the `===USER===` marker twice instead of importing `SYSTEM_USER_MARKER`.
- `src/ui/sections/PromptsSection.tsx:129` — hand-rolled slot regex `/\{\{(\w+)\}\}/g` that **disagrees with** the engine's `SLOT_RE` (`lib/prompt/template.ts:16`), which tolerates whitespace (`{{ name }}`). A template using `{{ bullets }}` renders fine but the editor shows a false "missing slot" badge. `extractSlotNames` already exists, is exported, and is tested.

**Why it matters.** §3's core rule is that consequential logic is pure, importable, and tested. `escalateChipInstruction` and `summarizeViolations` directly shape what gets sent to Anthropic and have zero coverage; the PromptsSection duplicate isn't just duplication, it's _divergent_ logic producing wrong UI signals.

**Proposed fix.** Move the three background helpers into `src/lib/prompt/` (e.g. `assemble.ts`) with tests (escalation tiers 1/2/3/4+, violation summarization per rule + banlist dedupe, slot population incl. reply vs post). Replace the two UI re-implementations with imports of `splitPrompt` / `extractSlotNames`.

---

### SEC-01 — `SECURITY-AUDIT.md` is stale: it audits the pre-redesign tree

**Severity:** Medium · **Dimension:** Security (documentation) · **Effort:** S

**Location:** `SECURITY-AUDIT.md` (items 1 and 7 name `AccountTab.tsx` and `DraftDisplay.tsx` — both deleted in `2ef89b6`); header says "v1 (Chunk 5)".

**What's wrong.** The document presents itself as the verification that §6 holds, but it verifies a tree that no longer exists. Beyond the dead file references, the redesign materially changed the audit surface and the doc doesn't cover it: the content script now **appends extension-owned elements and a `<style>` tag** to x.com pages (the §6 overlay carve-out, `twitter.content.ts:736–983`), runs a permanent rAF loop, and intercepts clicks in capture modes. Item 6's "No DOM writes" grep (`innerHTML=|insertAdjacent|...`) happens to still pass, but it no longer demonstrates the claim — the overlay code writes the DOM via `createElement`/`appendChild`, legitimately, under carve-out rules the audit never checks (attribute coverage, `pointer-events`, single interactive child).

**Why it matters.** For a public repo asking strangers to trust it with an API key, a stale security audit is worse than none — it's the first thing a skeptical reader will try to falsify. (For the record, I re-ran every boundary check against the current tree and **they all hold** — see "Checked and healthy" — so this is a documentation defect, not a regression.)

**Proposed fix.** Re-issue the audit against the current tree: fix file references (`AccountSection.tsx`, `ComposeScreen.tsx` copy path), add overlay-carve-out checks (every appended element carries `data-margin-overlay` — currently 17/17; all visuals `pointer-events: none`; exactly one interactive child whose handler only sends `content:dismiss-reply-context`), and date/commit-stamp the audit so staleness is detectable. Phase 3 should make "re-run SECURITY-AUDIT.md" part of the release checklist.

---

### MV3-02 — `await` before `chrome.sidePanel.open()` risks consuming the user-gesture window

**Severity:** Medium · **Dimension:** MV3 correctness · **Effort:** XS

**Location:** `entrypoints/background.ts:518–539` (`handleAutoReplyCommand`): `await chrome.storage.session.set(...)` at 526 runs before `chrome.sidePanel.open()` at 529; when no `senderTab` is passed, an `await chrome.tabs.query(...)` (521) also precedes it.

**What's wrong.** `sidePanel.open()` "may only be called in response to a user action" (Chrome 116+). Chaining async storage/tabs calls before it puts the call at the mercy of how long Chrome honors the gesture token — the code's own comment admits "Some Chrome versions reject `open` outside a tight user-gesture window." This makes the keyboard shortcut's headline feature flaky by construction.

**Proposed fix.** Call `chrome.sidePanel.open({ tabId })` _first_, synchronously within the command handler where possible, then set the `autoReplyCapture:v1` flag and broadcast. The flag consumers don't care about ordering (panel checks the flag on mount; already-open panels get the broadcast).

---

### MV3-03 — Manifest: no icons and no `minimum_chrome_version`

**Severity:** Medium · **Dimension:** Publishing / CWS review · **Effort:** S

**Location:** `wxt.config.ts:19–47`; confirmed in built `.output/chrome-mv3/manifest.json` (no `icons`, no `action.default_icon`, no `minimum_chrome_version`).

**What's wrong.**

1. **No icons.** Chrome shows the grey puzzle-piece placeholder in the toolbar; the Chrome Web Store **requires** a 128×128 icon to publish. This is a hard blocker for distribution and looks unfinished even for unpacked installs.
2. **No `minimum_chrome_version`.** The extension requires Chrome 116+ (`sidePanel.open()`; the sidePanel API itself is 114+, `oklch`/`color-mix` CSS is 111+). On older Chrome it would install and then malfunction. Set `minimum_chrome_version: "116"`.

**Proposed fix.** Add an icon set (16/32/48/128) under `public/` (WXT copies it through) + `manifest.icons`, and `minimum_chrome_version: '116'` in `wxt.config.ts`.

---

### API-01 — Prompt-caching comments and UI copy promise a discount that never materializes on the default model

**Severity:** Medium · **Dimension:** API correctness / honesty ethos · **Effort:** S

**Location:** `src/api/anthropic.ts:29–33` ("cached by Anthropic for ~5 minutes — reused-call cost drops to ~10%"), `:87–91` ("~90% discount on the cached portion"); `src/ui/sections/PromptsSection.tsx:195–201` ("no system framing, **no prompt caching**" warning implying caching otherwise works); template-marker rationale in `src/lib/prompt/template.ts:18–28`.

**What's wrong.** Verified against the current prompt-caching documentation: the **minimum cacheable prefix on Haiku 4.5 — the default model (`claude-haiku-4-5-20251001`, `src/types/settings.ts:79`) — is 4096 tokens**. The system block above `===USER===` is the style guide + exclusion rules + length rule — typically a few hundred tokens. Below the minimum, `cache_control` is **silently ignored** (no error; `cache_creation_input_tokens: 0`). So for essentially all real configurations, no caching ever happens, and the "~90% discount" claims in code and the "no prompt caching" warning in the options UI describe behavior the extension doesn't have. (The mechanics are otherwise correct: the `system: [{type:'text', …, cache_control:{type:'ephemeral'}}]` shape is the documented form, and examples couldn't be cached anyway since `selectExamples` reshuffles per generation.)

**Why it matters.** This repo's stated ethos is that the UI/code never overstates what's happening. The claim is also load-bearing for users reasoning about API spend.

**Proposed fix.** Keep the marker and the `cache_control` plumbing (harmless; genuinely kicks in if a user writes a very large style guide or switches to a model with a lower minimum — Sonnet 4.5 is 1024, Sonnet 4.6 is 2048). Correct the three comment sites and the PromptsSection warning to say what's true: the split improves model framing; caching only applies above the per-model minimum prefix (~4k tokens on the default Haiku), which typical configs won't reach.

---

### TEST-01 — Load-bearing deterministic logic with zero tests

**Severity:** Medium · **Dimension:** Test coverage · **Effort:** M

**Locations and gaps (from the real coverage run):**

1. `src/storage/config.ts:55–104` — `mergeWithDefaults` + `mergePromptTemplates` at **0 %**. This includes an actual documented **migration** (empty-body template fallback, comment at 69–79) and the nested-merge rules that decide whether a user's saved settings survive an upgrade. Pure logic, trivially testable (it only touches `chrome.storage` in the callers).
2. `src/api/anthropic.ts:152–184` — `mapHttpError` and `extractFirstTextBlock` at **0 %**. `mapHttpError` decides which of six UI error treatments the user sees for every failure; it's a pure function. (Testing `callAnthropic`'s body-building with a stubbed `fetch` would also pin the cache_control/system shape.)
3. `entrypoints/twitter.content.ts:418–709` — the entire extraction layer (`readVisibleText`, `readAuthorHandle`, `readDisplayName`, `readStatusId`, `readAvatarUrl` incl. its pbs.twimg.com gate, `detectReplyByDomStructure`, `findGrandparentArticle`, `isTweetTruncated`, `hasMedia`) is untested because it lives in an entrypoint. These functions are `Element → data` — under the repo's existing happy-dom setup they're testable with small HTML fixtures once extracted (ARCH-02/ARCH-03 enable this). They're also the code most likely to break silently when X changes markup; fixture tests give a place to encode each X-markup assumption.
4. `entrypoints/background.ts` prompt helpers — covered by ARCH-03.

Test _quality_ elsewhere is genuinely good — no filler found, assertions are behavioral, boundaries are tested (staccato 2-vs-3 runs, 4-vs-5 words, whole-word matcher, URL-counts-as-23, v1→v2 IDB migration with a hand-seeded v1 database, future-timestamp clock skew). One brittle spot is noted separately (TEST-02).

**Proposed fix.** Add `config.test.ts` (defaults pass-through, partial-settings merge, nested temperature/structuralRules merge, empty-body template restore, customized-body preservation), `anthropic.test.ts` for `mapHttpError`/`extractFirstTextBlock`, and extraction fixture tests after the ARCH-02 split. Also add `@vitest/coverage-v8` as a devDependency so coverage runs without ad-hoc installs.

---

### DOC-01 — README describes the pre-redesign product

**Severity:** Medium · **Dimension:** Docs accuracy · **Effort:** S–M

**Location:** `README.md`, concrete instances:

- **Usage flows are wrong:** "in the side panel's **Account** tab" (§Install step list — Account is now a full-page options section); "pick **Post** or **Reply** mode" (mode is now derived from whether a reply context is attached); "click **Capture reply context**" (the button flow was replaced by reply-context _mode_ — toggle, then click a tweet; the composer-based path survives only behind the keyboard shortcut); "~1s after you stop typing, the draft auto-refines" (§Refine — more/less is now an explicit **Apply** button / ⌘↵; nothing is debounced).
- **Boundaries section cites deleted files:** "`AccountTab.tsx`" (line ~145), "DraftDisplay renders posts as a list" (§Roadmap) — both deleted; the clipboard call now lives in `ComposeScreen.tsx`.
- **Stale counts:** "121 tests across 12 files" → 135 across 13.
- "manual/corpus balance slider (already in Settings, currently disabled)" — there is no such slider anywhere in the UI; only an inert settings field (see ARCH-04).
- Missing: nothing documents the overlay carve-out behavior users will _see_ on x.com (highlight + dismiss button), even though CLAUDE.md §6 requires the README to plainly state the `pbs.twimg.com` image carve-out (it currently doesn't mention avatars at all).

**Proposed fix.** Rewrite §Usage and §Architecture-boundaries against the current tree; fix counts; add the avatar-image carve-out paragraph §6 requires; describe the on-page overlay behavior. Phase 3 should treat README accuracy as part of done-ness for UI changes.

---

### QUAL-01 — Prettier fails on 43 files

**Severity:** Medium · **Dimension:** Quality gate · **Effort:** XS

**Location:** `npm run format:check` — 43 files including 28 source files (`entrypoints/background.ts`, `entrypoints/twitter.content.ts`, most of `src/ui/`, `src/types/settings.ts`, …).

**What's wrong.** CLAUDE.md §5/§9: "Run Vitest, ESLint, and Prettier clean before considering any chunk done" / "leave the tree … lint clean, tests passing." The HEAD commit was made with the format gate failing across most of the tree.

**Proposed fix.** `npm run format` once (pure-whitespace commit, separate from any logic change so blame stays useful). Decide whether `design_handoff_margin_redesign/` should be formatted or `.prettierignore`d (see REPO-01). Phase 3: add a `verify` script (`lint && format:check && compile && test && build`) and reference it from the working agreement.

---

### GIT-01 — Two mega-commits, HEAD message violates the repo's own commit convention, no branching

**Severity:** Medium · **Dimension:** Git hygiene · **Effort:** process (going forward)

**Location:** `git log`: `ed08bb4 feat: initial release (v1)` (85 files, +14,585) and `2ef89b6 Added new features and full UI overhaul` (69 files, +8,736/−2,801), both directly on `main`.

**What's wrong.**

- `2ef89b6` is not Conventional-Commits formatted (CLAUDE.md §4 requires it) and bundles at least four separable changes: the UI redesign, new features (reply-context mode, overlays, keyboard shortcut, theme), the design-handoff prototype bundle, and CLAUDE.md edits. It also committed the tree with Prettier failing (QUAL-01).
- Atomicity: a regression anywhere in the redesign is non-bisectable; revert is all-or-nothing.
- Everything lands straight on `main`; no feature branches, no PR checkpoint even as a solo discipline.

**Why it matters.** Phase 2 is about to make many changes; without a convention they'll inherit this shape.

**Proposed going-forward convention (to codify in Phase 3):**

1. Conventional Commits, enforced by habit (or commitlint if desired): `type(scope): summary` — e.g. `fix(content): reconnect panel port after SW restart`.
2. One logical change per commit; formatting-only and refactor-only commits separated from behavior changes.
3. Branch per work chunk (`chore/codebase-hardening` for Phases 1–3), merged to `main` only with the verify gate green.
4. Design artifacts / prototypes never ride along in feature commits.

---

### PERF-01 — rAF loop scans every tweet article on every frame while a reply-context lock is active

**Severity:** Medium · **Dimension:** Performance (on x.com) · **Effort:** S

**Location:** `entrypoints/twitter.content.ts:339–363` (the rAF tick) calling `findArticleByStatusId` (`:528–534`), which runs `document.querySelectorAll('article[data-testid="tweet"]')` **plus** `readStatusId` (another `querySelector` + regex) per article, ~60×/second for as long as a lock is set and the panel open. The loop itself also runs forever on every x.com tab, even with no mode active (the idle iterations are cheap, but nonzero, and `reposition()` still executes two display-checks per frame).

**Why it matters.** X timelines render dozens of articles; this is O(articles) DOM queries per frame on someone else's site — exactly the kind of background cost an extension shouldn't impose. It's also unnecessary: the article's position must be tracked per-frame (cheap, one `getBoundingClientRect`), but _re-finding_ it only matters when X's virtual scroller remounts nodes — a rare event.

**Proposed fix.** Keep per-frame `reposition()` of known targets, but throttle the `findArticleByStatusId` re-scan to ~4–8×/second (timestamp gate inside the tick), or trigger re-find only when the cached lock element's `isConnected` goes false. Optionally suspend the rAF loop entirely while `captureMode === 'none' && !lock` and resume on state change.

---

### ARCH-04 — Dead code cluster

**Severity:** Low · **Dimension:** Architecture / §3 "no speculative abstraction" · **Effort:** S

**Itemized (all verified unused by grep):**

1. `bg:focus-voice` — still **broadcast** on every capture (`entrypoints/background.ts:617`) but handled by no one; `src/ui/App.tsx:127–130` says it's "now a no-op; left in the contracts for backward compatibility with already-broadcast notices" — notices are ephemeral; there is no compat concern. Remove the broadcast, the contract member, and the guard entry.
2. `bg:capture-notice` — defined in `src/messaging/contracts.ts:114–119` and in `isBackgroundNotice` (`:169`), never sent, never handled.
3. `clearApiKey` (`src/storage/key.ts:64–68`) — never called; its comment says "e.g. on uninstall flows", but MV3 extensions cannot run code on uninstall, so the described flow is impossible.
4. `isOverSoftCap` (`src/lib/counting/twitter.ts:58–60`) — never called by app code; the soft cap is enforced only as a prompt instruction. Either wire a soft-cap warning into the draft footer or delete.
5. `getItemsByType` (`src/storage/corpus.ts:117–124`) — used only by its test. Borderline (natural corpus API); keep only if Phase-2 import will use it, else delete with its index? — note the **`byType` index itself should stay** (schema), this is just the accessor.
6. `manualCorpusBalance` (`src/types/settings.ts:32–34, 88`) — declared, defaulted to 70, never read anywhere. It is _not_ one of the four §8 seams. Delete the field (storage merge tolerates leftovers), or move the rationale into CLAUDE.md §8 if it must stay.
7. `void handle; // kept in scope for now…` (`src/ui/VoiceScreen.tsx:63`) — leftover, and wrong: `handle` _is_ used at `:138` (`<CaptureBanner handle={handle} />`). Delete the statement and comment.
8. `void IcSettings; // Silence unused import while sections wire up.` (`src/ui/OptionsPage.tsx:156–157`) — sections are wired; delete the import and the hack.

---

### QUAL-02 — Stale / misleading comments (the why-comments are otherwise excellent; these specific ones now lie)

**Severity:** Low · **Dimension:** Comment quality · **Effort:** S

**Itemized:**

1. `src/messaging/contracts.ts:62–65` — says reply-context selection "auto-clears the mode (one-shot)". The background deliberately does the opposite (`entrypoints/background.ts:186–191`: "Reply-context mode stays ON deliberately").
2. `src/storage/replyContextLock.ts:9–12` — claims the lock is cleared "when the user navigates within X's SPA (handled by the content script reading the URL and notifying us)". The content script explicitly preserves the lock across navigation (`twitter.content.ts:72–75`, `345–356`).
3. `src/types/capture.ts:7–9` — references a `extractionError` field that doesn't exist anywhere (failures flow via `content:capture-failed`).
4. `src/ui/sections/AccountSection.tsx:183` — Verify button title says "Calls Anthropic with max_tokens: 1"; `verifyKey` uses `maxTokens: 8` (`src/api/anthropic.ts:195–205`) for a documented reason.
5. `src/storage/captureMode.ts:10–11` — "The two toggles (CaptureControls + Composer reply toggle)" — `CaptureControls.tsx` was deleted; the toggles are now `VoiceScreen`'s CaptureBanner and `ComposeScreen`'s ReplyContextBanner.
6. `src/lib/screening/predicates.ts:3–5` — "In v1 these only power a soft 'low-quality?' hint on the Voice tab" — nothing imports the predicates; no such hint exists. Either wire the hint or state plainly that the module is dormant until Phase-2 import (CLAUDE.md sanctions the seam; the comment shouldn't invent a current use).
7. `src/types/settings.ts:55–57` — "Real bodies arrive in Chunk 3; the shape lives here so the storage and settings UI can refer to it now" — the bodies are 10 lines below.
8. `src/lib/prompt/defaults.ts:115–117` — "Char constraints are an _instruction_, not a hard validation, in Chunk 3 — exact counting + overage repair land in Chunk 4" — the tighten pass landed (`background.ts:419–444`).
9. `entrypoints/twitter.content.ts:646–650` — labels the composer-based extractor "(legacy keyboard-shortcut path)" / "deprecated button flow" — it is the _live_ implementation behind the Alt-Shift-R shortcut (`panel:capture-reply-context` → `bg:capture-reply-context-request`). Say what it is.
10. `src/storage/key.ts:15–18` — "never holds the value in React state beyond the input field for as long as the user is editing it" — AccountSection loads the stored key into state on mount and holds it for the section's lifetime (see SEC-02). Make the comment match whichever behavior is chosen.
11. Private dev-log jargon in a public repo: "Chunk 2/3/4/5" references (`background.ts:10,612`, `config.ts:71`, `draft.ts:9`, `predicates.ts:62`, `settings.ts:56`, `SECURITY-AUDIT.md:1`) mean nothing to outside readers. Replace with feature names or drop.
12. `README.md:7` "~7,000 lines of TypeScript" — now ~9.6k incl. styles; round up or drop the number.

---

### PERF-02 — "Clear voice library" issues one IndexedDB transaction per item

**Severity:** Low · **Dimension:** Performance / correctness on partial failure · **Effort:** XS

**Location:** `src/ui/sections/DataSection.tsx:71–85` — `Promise.all(items.map((i) => deleteItem(i.id)))`; each `deleteItem` opens its own `readwrite` transaction (`src/storage/corpus.ts:105–108`).

**What's wrong.** For the "potentially thousands of items" corpus CLAUDE.md plans for, this is thousands of transactions, and a mid-flight failure leaves a half-cleared library with no indication of which half.

**Proposed fix.** Add `clearAllItems()` to `corpus.ts` using a single `store.clear()` in one transaction; call it from DataSection. One small test alongside the existing corpus suite.

---

### UX-01 — "Verify" checks the saved key while the UI implies it checks what you just typed

**Severity:** Low · **Dimension:** UX correctness · **Effort:** XS–S

**Location:** `src/ui/sections/AccountSection.tsx:82–98` (verify sends `panel:verify-key`; background reads the key from storage, `entrypoints/background.ts:137–144`) vs. `:182` (button is enabled by the _local input_ being non-empty).

**What's wrong.** Type a new key → click Verify before Save → the background verifies the **old stored key** and happily reports "Key works". The user believes their new key is valid; generation later fails (or worse, quietly burns the old key's quota).

**Proposed fix.** Either (a) disable Verify while the input differs from the stored value ("Save first"), or (b) make Verify save-then-verify. (a) is simpler and keeps the explicit-save semantics this section is documented to have.

---

### DOC-02 — HTML document titles still say "X Post Composer"

**Severity:** Low · **Dimension:** Docs / consistency · **Effort:** XS

**Location:** `entrypoints/sidepanel/index.html:6` ("X Post Composer"), `entrypoints/options/index.html:7` ("X Post Composer — Settings") vs. manifest/product name "Margin".

**Proposed fix.** Retitle ("Margin", "Margin — Settings"). The title is user-visible in the options tab and in a11y surfaces.

---

# Consider findings

Judgment calls — defensible either way; my recommendation included.

---

### SEC-02 — Stored API key is read back into options-page React state and the DOM on every mount

**Severity:** Medium · **Dimension:** Security posture · **Effort:** S

**Location:** `src/ui/sections/AccountSection.tsx:33–47` (mount effect → `getApiKey` → `setApiKeyLocal(storedKey)`), rendered into `<input type="password" value={apiKey}>` (`:134–140`).

**What's wrong / the judgment call.** CLAUDE.md §6 permits the key in "the settings field where the user enters it", and this _is_ that field — so this is within the letter of the rule. But the current implementation round-trips the **stored** key into page state/DOM unprompted on every visit to the Account section, where it's one inspect-element (`type=password` → `text`) or React-devtools read away. The companion comment in `key.ts` claims the value is held "only while editing", which isn't what happens (QUAL-02 #10). The tighter pattern costs little: never read the key back; show set/not-set status (`getApiKey(...) !== ''`) with a masked placeholder ("Key is set — enter a new one to replace, leave blank to keep"), and only ever _write_. This also shrinks the blast radius of any future XSS-class bug in the options page and makes boundary-grepping cleaner (`getApiKey` callers drop to background-only + a boolean probe).

**Recommendation:** adopt write-only semantics; it strengthens the repo's marquee invariant for ~an hour of work.

---

### SEC-03 — `Avatar` renders stored URLs without re-validating the host

**Severity:** Low · **Dimension:** Security (defense in depth) · **Effort:** XS

**Location:** `src/ui/Avatar.tsx:32–40` (`<img src={src}>`); upstream validation only at capture time (`entrypoints/twitter.content.ts:622–630`).

**What's wrong / the judgment call.** Today every `authorAvatarUrl` that reaches IndexedDB passed the `^https://pbs\.twimg\.com/` gate, so there's no live hole. But the §6 carve-out is image-host-specific, the extension-page CSP doesn't restrict `img-src`, and the README roadmap includes a JSON **import** path — at which point arbitrary URLs in a crafted backup would be fetched by the panel (a classic tracking/exfil-pixel vector). The cheap, durable enforcement point is the single render site.

**Recommendation:** add the same host test in `Avatar` (fall back to initials on mismatch) + one comment tying it to §6. Do it now while it's one line, not when import lands.

---

### API-02 — `callAnthropic` has no request timeout

**Severity:** Low · **Dimension:** API robustness · **Effort:** XS

**Location:** `src/api/anthropic.ts:98–107`.

A hung connection leaves the panel in "Drafting…" until the MV3 worker is killed, with no user-facing error. `fetch(..., { signal: AbortSignal.timeout(60_000) })` converts that into the existing `network` error path. (Sequenced-request guards in ComposeScreen already handle the stale-response side.)

---

### MODEL-01 — Model is invisible/uneditable in the UI; `temperature` is unconditionally sent

**Severity:** Low · **Dimension:** Transparency / forward-compat · **Effort:** S

**Location:** `src/types/settings.ts:20–21` ("Becomes a dropdown later"), no UI surface reads `settings.model`; `src/api/anthropic.ts:87–92` always sends `temperature`.

For an "honest wrapper", the model in use is information the user should see without reading source — and today it can't be changed except by editing storage in devtools. Verified against the current model catalog: the default `claude-haiku-4-5-20251001` is an **active, current ID** and a sensible cost/latency default for ≤280-char drafting; note that newer Opus models (4.7/4.8) **reject** `temperature` (400), so the unconditional temperature send sets a small trap for any future model dropdown.
**Recommendation:** show the model read-only in Account now (one line), and when the dropdown lands, gate `temperature` by model family. Optionally prefer the undated alias `claude-haiku-4-5` (CLAUDE.md says verify IDs from docs; the alias tracks snapshots automatically — a pinned dated ID is also defensible for reproducibility; pick one and comment why).

---

### ARCH-05 — `setSettings` read-merge-write can race across surfaces

**Severity:** Low · **Dimension:** Architecture · **Effort:** S (if addressed)

**Location:** `src/storage/config.ts:30–34`.

Panel and options page are separate contexts that each do `getSettings → spread patch → set`. Two near-simultaneous writes (e.g. dragging the pool-size slider while a banlist blur fires, or panel + options both open) can drop one patch. Practical risk is low (writes are field-disjoint and humans are slow), which is why this is Consider, not Fix.
**Recommendation:** leave it, but document the single-writer-per-field assumption in `config.ts`; if it ever bites, the fix is per-field storage keys, not locking.

---

### UX-02 — Chip editor persists the whole settings record on every keystroke

**Severity:** Low · **Dimension:** UX / perf · **Effort:** S

**Location:** `src/ui/sections/PromptsSection.tsx:236–244` (`patch`/`remove`/`add` call `onSave` synchronously from `onChange`).

Every keystroke in a chip label/instruction → `setSettings` → storage write → `subscribeSettings` fan-out re-renders the panel → "Saved" flash. Functionally fine (`storage.local` has no meaningful write quota), but noisy and inconsistent with the blur-to-save pattern used by the banlist and template editors.
**Recommendation:** save on blur (matches siblings), or debounce ~500 ms.

---

### UX-03 — Some capture failures are deliberately silent

**Severity:** Low · **Dimension:** UX · **Effort:** XS–S

**Location:** `entrypoints/background.ts:732–742` (`failureReasonToSaveResultKind` returns `null` for `missing-text` / `missing-author` / `unknown`, with a comment defending the silence).

In capture mode the user clicked a tweet and _nothing happened_ — that's a swallowed failure from their perspective, in tension with CLAUDE.md §4 ("errors are handled, never swallowed"). The reasons are rare (X markup drift), which is exactly when a user needs a signal that the extension, not their click, failed.
**Recommendation:** map them to a generic "Couldn't read that tweet — X may have changed its markup; try Add manually" banner kind. Keep `no-tweet-under-cursor` silent (that one genuinely means "you didn't click a tweet").

---

### TEST-02 — `relativeTime` tests are timezone-sensitive

**Severity:** Low · **Dimension:** Test brittleness · **Effort:** XS

**Location:** `src/lib/format/relativeTime.test.ts:33–41` asserts local-date renderings ("Apr 5", "Jan 15") from fixed `Z` timestamps; `formatRelativeTweetTime` deliberately uses local date parts (correct product behavior — it matches what x.com shows the local user). On a machine/CI in UTC−11/−12 the date boundary shifts and the assertions fail.
**Recommendation:** pin `TZ=UTC` in `vitest.config.ts` (`test.env`) or compute expected values from the same `Date` APIs.

---

### REPO-01 — Repo hygiene: `.claude/` not ignored by the repo; design prototype committed at root

**Severity:** Low · **Dimension:** Repo hygiene · **Effort:** XS–S

1. `.claude/settings.local.json` exists on disk and is untracked only thanks to the _author's user-global_ gitignore. Other contributors' local agent settings would show up as untracked and can be committed by accident. Add `.claude/settings.local.json` (or `.claude/`) to the repo `.gitignore` (which is otherwise thoughtfully curated — see healthy list).
2. `design_handoff_margin_redesign/` (~2.6k lines of prototype JSX/HTML/CSS, explicitly labeled "not production code") is committed at the repo root and is part of the Prettier failure set. For a public repo whose pitch is "read the whole thing", a parallel second implementation at root is noise.
   **Recommendation:** move it to `docs/design/` with a one-line README pointer (history already preserves it), or remove it; `.prettierignore` it either way.

---

### DATA-01 — Export payload labels itself `schemaVersion: 1` while rows carry the DB-v2 shape

**Severity:** Low · **Dimension:** Data / future import · **Effort:** XS

**Location:** `src/ui/sections/DataSection.tsx:44–48` vs. `src/storage/corpus.ts:18` (`DB_VERSION = 2`).

Harmless today; ambiguous the day Phase-2 _import_ validates `schemaVersion`. Decide what the export schema version means (its own counter vs. mirror of `DB_VERSION`), define it as a constant next to `DB_VERSION`, and use it in both places.

---

### DEV-01 — ESLint is on the non-type-aware tier

**Severity:** Low · **Dimension:** Tooling · **Effort:** S

**Location:** `eslint.config.js:10` (`tseslint.configs.recommended`).

The codebase manually maintains floating-promise discipline (`void` everywhere) that `recommendedTypeChecked` + `@typescript-eslint/no-floating-promises` would enforce mechanically — a good fit for a security-sensitive repo where an unhandled rejection in the background worker means a silent failure.
**Recommendation:** switch to `recommendedTypeChecked` with `projectService: true`; budget a small cleanup for newly flagged sites.

---

### DEP-01 — `npm audit`: 8 vulnerabilities, all confined to the dev toolchain

**Severity:** Low · **Dimension:** Supply chain · **Effort:** XS (+ upstream wait)

**Location:** `npm audit`: `shell-quote` ≤1.8.3 (**critical**, GHSA-w7jw-789q-3m8p) via `fx-runner`; `tmp` <0.2.6 (**high**, GHSA-ph9p-34f9-6g65, _no fix available_) and `node-notifier`/`uuid` (moderate) — all transitive under `wxt → web-ext-run`, i.e. the dev-mode browser launcher. **`npm audit --omit=dev`: 0 vulnerabilities**; nothing in the shipped extension is affected, and the runtime bundle was verified to contain no unexpected hosts.
**Recommendation:** run `npm audit fix` (resolves the fixable ones), track `wxt`/`web-ext-run` releases for the `tmp` chain, and note in the README/SECURITY doc that audit policy = "prod must be clean; dev-only findings tracked". An `overrides` block is possible but not worth the maintenance for dev-only reach.

---

# Checked and healthy

So the coverage of this audit is confirmable, the following were explicitly inspected and found sound:

**Security invariants (CLAUDE.md §6) — every one independently re-verified on this tree:**

- **API key boundary holds.** `getApiKey/setApiKey/migrateApiKey` callers: `entrypoints/background.ts` + `AccountSection.tsx` (the sanctioned settings field) only. `src/api/anthropic.ts` is imported by exactly one file: the background entrypoint. The content-script bundle (`.output/chrome-mv3/content-scripts/twitter.js`) contains no `api.anthropic.com`, `x-api-key`, or `apiKey` strings.
- **Key never logged.** The only two `console.*` calls in the codebase (`background.ts:90,533`) log sidePanel errors with no key in scope. Error paths in `anthropic.ts` never echo the key; it travels only in the `x-api-key` header.
- **No `chrome.storage.sync` anywhere** (the single grep hit is the explanatory comment). Ephemeral state correctly uses `storage.session` (capture mode, reply lock, last prompt, auto-reply flag).
- **Single external endpoint.** One `fetch` in the codebase, targeting `https://api.anthropic.com/v1/messages`. Built-bundle host scan: `api.anthropic.com`, x/twitter hosts, plus two benign string artifacts — `twemoji.maxcdn.com` (dead code inside `twitter-text`'s emoji table, unreachable via `parseTweet`, and blocked by host_permissions even if reached) and `react.dev`/`w3.org` (React error-URL + SVG namespace constants). No telemetry, no analytics.
- **`anthropic-dangerous-direct-browser-access` usage is correct and deliberate**: `api.anthropic.com` is intentionally _not_ in `host_permissions`, so the SW fetch is CORS-bound and the header is what makes it work — a tighter permission posture than whitelisting the host.
- **Model/API currency verified against docs.claude.com**: `claude-haiku-4-5-20251001` is a current, active model ID; `anthropic-version: 2023-06-01` is current; the `system`-array-with-`cache_control` request shape is the documented form; `max_tokens: 1024` is ample for ≤280-char drafts; `verifyKey`'s `maxTokens: 8` rationale is sound.
- **Read-only contact with X's DOM + overlay carve-out compliance.** No `innerHTML`/`dangerouslySetInnerHTML`/`insertAdjacent` anywhere. The overlay system matches §6 bullet-for-bullet: every extension-rendered element carries `data-margin-overlay` (17 occurrences, one grep finds them all), all visuals are `pointer-events: none`, exactly one interactive child (the dismiss button) whose handler only sends `content:dismiss-reply-context` (clears extension-side state only), nothing is ever written onto X's own elements, overlays hide on panel-close/mode-off/dismiss and drop off-page on SPA navigation via the statusId re-find. Capture-mode click interception passes through clicks on X's interactive elements (`button, a, [role=button], [role=link]`).
- **Manifest hygiene.** Permissions are exactly the §6 set (`storage`, `sidePanel`, `clipboardWrite`, `unlimitedStorage`); host permissions are exactly the four x/twitter origins; no `<all_urls>`; content script in the default isolated world; MV3 default CSP (`script-src 'self'`) — no `eval`, no remote code, no CSP weakening; `imports: false` keeps every import explicit and auditable.
- **Messaging attack surface.** No `externally_connectable`, so `runtime.onMessage` is reachable only from the extension's own contexts; web pages and other extensions cannot message it. Page-controlled content (tweet text) flows only into prompt text and React-escaped rendering — no DOM-injection or eval sink for it anywhere; `highlights.tsx` builds React nodes, never HTML strings.
- **Avatar fetch carve-out** is enforced at capture (`pbs.twimg.com` regex) with `referrerPolicy="no-referrer"` + `alt=""` at render (see SEC-03 for the render-side hardening suggestion).

**Architecture & seams:**

- All four CLAUDE.md §8 deferred-feature seams are intact and uncollapsed: `Draft = { posts: PostDraft[] }` (length-1 discipline maintained — UI reads `posts[0]` without assuming string drafts), `LibraryItem.embedding: null` present on every write path and in the schema, `selectExamples(mode, context, library, opts)` is the single sampling entry with injected RNG, IndexedDB is versioned (v1→v2 migration with cursor backfill, never edits old upgrade blocks).
- Layer boundaries are real: storage/messaging/UI/api communicate through typed contracts (`src/messaging/contracts.ts` is a model of a typed message union with role-prefixed names and honest comments — modulo the two stale ones in QUAL-02).
- The brain that _is_ in `src/lib/` is genuinely pure (no React/DOM/chrome/fetch imports anywhere under `lib/`), small, and idiomatic. The `twitter-text` CJS/ESM dual-shape workaround is documented and guarded with a hard failure.
- `storage.session` for capture mode means content scripts can't read it directly — kept trusted-only and mirrored via messaging; correct trade-off, and documented.

**Tests:** the suite is high quality — behavior-focused, boundary-driven (staccato 2-vs-3 and 4-vs-5-word edges, whole-word matcher incl. apostrophes and multi-word entries, URL-weighs-23 counting, weighted-280 gate, duplicate-id constraint, hand-seeded v1 database migrated to v2, future-timestamp clock skew, deterministic RNG injection for shuffle). No filler tests, no implementation-detail assertions found.

**Tooling & config:** strict TS with `noUncheckedIndexedAccess` (stronger than CLAUDE.md requires) compiles clean; ESLint clean; build clean; WXT usage matches current documented conventions (`defineBackground`/`defineContentScript` from `wxt/utils/*` with auto-imports off, entrypoints layout, commands manifest, side-panel behavior). `.gitignore` is thoughtfully curated for a key-handling repo (secret patterns, personal X-archive patterns, coverage). `LICENSE` (MIT) exists and matches `package.json`. Production dependency tree is minimal (3 packages) and audit-clean.

**UX correctness details that were checked and hold:** latest-call-wins request sequencing in ComposeScreen (`requestSeq`); single-level Undo restores draft+violations+repaired state coherently; clipboard is the only output path; duplicate capture detection via IndexedDB `ConstraintError`; settings merge preserves user-customized template bodies while restoring blanked ones.

---

## Suggested Phase-2 ordering

1. **QUAL-01** (format the tree — isolates whitespace from everything that follows)
2. **MV3-01, MV3-02, MV3-03** (behavioral fixes, small and self-contained)
3. **ARCH-01** then **ARCH-03** (single-source templates → move brain to lib + tests; unblocks TEST-01 items 1–2)
4. **ARCH-02** (mechanical splits; do after ARCH-03 so moved code lands in its final home; unblocks TEST-01 item 3)
5. **TEST-01**, **PERF-01/02**, **UX-01**, **API-01**, **ARCH-04**, **QUAL-02**, **DOC-01/02**, **SEC-01** (docs last so they describe the hardened tree)
6. Consider-list items as approved.

— End of audit.
