# Voice Composer for X — Product Roadmap & Design Source of Truth

_Last updated: June 2026. This document is the canonical reference for what we're building and why. Every Claude Code build prompt from here forward should be derived from it. When a decision recorded here turns out wrong, update this doc rather than silently diverging — same discipline as `CLAUDE.md`._

---

## North Star

The highest-quality, most genuinely-_in-your-voice_ composer for serious writers on X — and radically transparent in a market full of opaque engagement-farming tools.

The wedge is **taste and trust**, not volume. The target user posts deliberately and would be embarrassed by AI-sounding output: founders, writers, researchers, people building a reputation. That segment is underserved precisely _because_ most competitors chase the volume crowd — which means the crowdedness of the space is our friend, not our problem. Everyone else races toward automation and scale; that leaves the "I want to sound like _me_, better and faster" lane open.

Three commitments flow from this and should not be quietly eroded by any feature:

1. **All-in on X.** Depth on one platform is the moat. We do not spread across LinkedIn/TikTok/Instagram (see _What We're Deliberately Not Building_).
2. **Honest LLM wrapper.** Prompts are visible and editable; the user can always inspect exactly what was sent to the model. We are the opposite of a slick UI hiding a thin prompt. Transparency is a feature, not an afterthought — it's load-bearing for trust.
3. **Local-first, BYO-key, privacy-preserving.** The user's data and key stay on their machine; the only external call is to their chosen LLM provider. No middleman server.

---

## Core Concepts

_These four systems underpin nearly every roadmap item. They're documented here once, in full, so individual phase items can reference them without re-explaining._

### A. The Example-Streams Model (how we define the user's voice)

The user's voice is taught to the tool through saved writing. There are **three sources** and **one orthogonal quality flag**. Keeping these on separate axes is what makes the whole model coherent — the early confusion came from treating them as competing peers.

**Source** — where an item came from. System-assigned, mutually exclusive, every item has exactly one:

- `manual` — handpicked by the user ("save to voice"). The user individually chose it.
- `shipped` — a draft composed in the tool, approved, and copied out to X. Self-curating; accumulates automatically over time (see _Draft Lifecycle_).
- `archive` — bulk-imported from the user's X archive export. High volume, **unfiltered** — its job is breadth, not curation.

**Star** (`favorite: boolean`) — a judgment the user lays on top, **orthogonal to source**. Any individually-engaged item can be starred. This is _not_ a fourth source; it's a flag on a different axis. A shipped tweet you love is `source: shipped, favorite: true`. This is why "can something be both shipped and a favorite?" was never really a conflict — they're different dimensions.

**Why stars exist as a distinct tier:** handpicking changes job over the tool's life. Early on it's an _onboarding_ move (bootstrap a high-signal pool fast). Later it becomes a _canon_ move — the crown jewels, "you at your best, the bar every tweet should hit." If favorites just sat in the general pool with equal sampling odds, your ceiling would get averaged back into your mean — the exact thing the feature is meant to prevent. So stars get **guaranteed presence**, not just better odds.

**Sampling model** (how examples are chosen per generation):

- **Two sampled tiers, balanced by a slider:**
  - _Curated_ = `manual` + `shipped`, pooled. Filled first.
  - _Archive_ = the noisy backstop. Tops up only to the extent curated doesn't fill the budget.
  - Controlled by the **balance slider** (default 70/30 curated/archive) and the **sample-size slider** (`poolSize`, min 5 / max 40 / default 20). The balance slider is inert until an archive exists (Phase 7).
- **Stars sit on top, with their own pool:** a **fixed N** of starred items (user-adjustable, default ~3–5, hard-capped at a fraction of the total budget so they can't drown out range), **shuffled** among all stars, **guaranteed in every prompt** — separate from and additive to the `poolSize` sampled pool. This is the structural fix for the drowning-out problem: stars never compete for sample slots because they were never in the pool.

**Starring boundary & promotion:**

- Starring is available on `manual` and `shipped` items only. The archive is, by definition, the stream you _haven't_ individually engaged with — so you don't star from it directly.
- To elevate an archive tweet: **find it via X's own search, then handpick it** through the normal capture gesture. No archive-browser feature needed — X's search is better than anything we'd build, and it's where the user's muscle memory already lives. The promotion _is_ the act of attention.
- **Dedupe on capture:** if a handpicked tweet already exists in the library (commonly: it's also in the archive), the handpick **wins and updates the existing record** (`source → manual`) rather than inserting a duplicate. Same logic applies to a shipped tweet later handpicked. Dedupe key: tweet ID if captured, normalized text otherwise. Missing this silently skews the voice toward whatever got double-counted.

### B. Prompt Architecture ("prompt-assembly-v2")

_(Graduated 2026-06-11: Phase 1 shipped this concept; the as-built rationale is now canonical in `design.md` → "Prompt architecture (as built)". The text below is preserved as the original design intent — the aspirational block's population still lands with the Star tier in Phase 5.)_

Everything is text to the model at send time — there is no separate "attachment" channel that gets parsed more rigorously. What makes a model _use_ context well is **structure, labeling, and explicit priority**, not delivery mechanism. The current prompts are tidy but predate several decisions and have one quiet quality leak (voice-blind refinements). The principles:

- **System / user boundary, decided by one test: does this block change between two consecutive calls?**
  - _System_ (invariant call-to-call): role definition, the "output ONLY the text, no preamble/quotes" rule (stated once here, not repeated per template), the precedence preamble, the style guide, and the exclusions.
  - _User_ (changes call-to-call): the example blocks (freshly sampled each call → user), the reply context, the length constraint (set per-composition), and the intent.
  - Bonus: a stable system block is **cacheable** — a real latency/cost win later for a tool firing many short calls per session. Getting the boundary right today keeps that option open; a sloppy boundary forfeits it.
- **XML-style tags delimit every block** (e.g. `<style_guide>…</style_guide>`). Models respect explicit open/close boundaries far more reliably than ALL-CAPS headers, and the benefit scales as the prompt grows. Replaces the current caps headers and the literal `===USER===` marker notation. _(Reconciled 2026-06-11: the split already reaches the API as real message roles today — `splitPrompt` sends everything above the marker as the `system` parameter (`lib/prompt/template.ts` → `background/generation.ts`). What's genuinely open is the template **storage/editing** mechanism — explicit two-body templates vs. a formalized marker — settled at the Phase 1 build; see the Build Decisions Log.)_
- **Two example blocks, not three:**
  - `<aspirational_examples>` — the starred items. Instruction: _"the user at their best; the bar to reach for."_
  - `<voice_examples>` — the sampled curated/archive pool. Instruction (keep the current good framing): _"match tone and rhythm, not topic."_
  - Curated-vs-archive is a _sampling-weight_ decision, not a labeling one — the model doesn't need to know a sampled example's origin. Only stars carry a distinct instruction, so only they get a distinct block.
- **Precedence preamble, fixed in code** (this is an opinionated decision, not a user setting): exclusions are hard constraints → style guide is authoritative → aspirational examples are the bar → voice examples are range → reply context is _to react to, not imitate_ → intent is what to develop.
- **Refinements carry a voice anchor.** _(This is the highest-impact fix.)_ The current chip / more-less / repair / tighten prompts contain only the previous draft + an instruction — no style guide, no exclusions. They're voice-blind, so each pass drifts toward generic, which is why polish passes through the original prompt felt necessary. Fix: every refinement gets a proper system block (role + output rule + style guide + exclusions). Carrying exclusions also prevents refinements from _reintroducing_ banned patterns (fewer repair round-trips).
- **Chip and freeform refinement collapse into one template.** Once more/less becomes a single freeform instruction acting on the previous draft, it's structurally identical to a chip (instruction + previous draft + voice anchor). One refine template, two entry points (canned chip vs. typed feedback). Repair and tighten are the same template with a system-supplied instruction.
- **Intent framing varies by input shape.** Disconnected fragments → _"these are loose thoughts; find the throughline and weave them."_ Flowing prose → _"this is a direction to develop and tighten."_ Same content, different job. A simple "does this look like a list?" heuristic is enough — don't over-engineer the classification; the user can always lean one way.
- _(The "tweet.md" idea resolves here: the value was never a user-facing markdown export — it was clean, structured, labeled context. That's exactly what this section delivers internally. No export feature.)_

### C. Draft Lifecycle (one model that resolves many small questions)

Several dogfooding items were really symptoms of the tool lacking a crisp draft state model. Designing it once dissolves them.

**States:** `empty` → `generating` → `active` (editable, refinable) → `committed` (on copy-to-X).

- A draft is **active** from generation through any editing/refinement.
- **Copy-to-X commits it.** Copy is the lifecycle "done" signal: it resolves any pending timed-undo, (optionally) saves the committed text to the corpus as a `shipped` example, and arms the workbench to accept new context.
- **Two distinct meanings of "done" that must not be collapsed:** "I'm done with this draft in the tool" (a _lifecycle_ state) vs. "this text became a published tweet" (a _corpus_ event). Copy signals both, but they're modeled separately — conflating them is what would let the corpus fill with not-quite-final text.
- **New context and Regenerate replace the active draft**, each guarded by a **timed undo (~5 seconds, the Gmail-undo-send convention)** — never a confirmation modal. Replace immediately, show an unintrusive "undo?" toast, commit if untouched.
- **Manual edits keep the draft active and ride through the commit** — they're part of what ships.
- **Two undo scopes coexist:** the _timed undo_ reverses a draft _replacement_ (new context / regenerate); the _one-level refinement undo_ reverses a _refinement_ (chip / freeform / polish). Different scopes, both present.

### D. Security & Data Posture (enforced by `CLAUDE.md`; summarized here)

- **BYO key.** The key lives only in the background service worker's reach — never injected into the X page, never in a content script, never logged, never anywhere except the LLM provider call. Stored in `chrome.storage.local` (never `.sync`); an optional in-memory `session` mode exists for cautious users.
- **No fake at-rest encryption** (it's security theater on a public repo). Honest posture: stored unencrypted, protected by the OS account + extension sandbox; blast radius of a leak is bounded to API spend and is fully revocable; **users should set a spend cap.** Stated plainly in README and near the key field.
- **No telemetry, no phoning home, no analytics.** One external API host only (plus inbound avatar images from `pbs.twimg.com` — the image-only carve-out in `CLAUDE.md` §6).
- **Read-only DOM contact, never writes, never auto-posts.** Output goes to the clipboard only. DOM reads anchor on the most stable hooks available and degrade gracefully.
- **Privacy claim is precise:** "no middleman server," _not_ "nothing leaves your device" — tweet content and drafts are sent to the chosen LLM provider as prompt content. Say so.
- **Corpus in versioned IndexedDB** (local, unsynced); config + key in `chrome.storage.local`. **Export-library-as-JSON** is the portable backup, since local data doesn't follow the user across machines.

---

## Sequencing Rationale

Order is driven by dependency and felt-improvement-per-unit-work, not excitement. The discipline: **the polish work (bugs, the passive draft view) is what makes the tool feel rough _right now_; the ambitious features (bundles, threads) are what make it feel impressive. Ship the polish first — a rough tool with amazing features still feels rough.** Don't let later phases jump the queue because they're the fun part.

Two dependency notes that fix the order:

- **The direct editor (Phase 3) must precede the shipped-tweet corpus loop (Phase 4).** Until the editor exists, the user finishes drafts in X's box, so the copied text ≠ the posted text — saving it would pollute the corpus with pre-final versions during exactly the window drafts are least final. The editor makes copied ≈ posted, which makes the loop trustworthy.
- **Prompt-assembly-v2 (Phase 1) creates the `<aspirational_examples>` block, but the Star tier (Phase 5) populates it.** The block ships present-but-empty and lights up when stars exist — same seam pattern as the deferred embedding field.

---

## Phase 1 — Prompt Assembly v2

**✅ Shipped 2026-06-11** (`feat/prompt-assembly-v2`). _As-built rationale graduated to `design.md` → "Prompt architecture (as built)"; the build-time judgment calls are in the Build Decisions Log below. The `<aspirational_examples>` block shipped present-but-empty per the sequencing note — Phase 5 populates it._

_Self-contained, sits behind the existing assembly seam, and improves **every generation and every refinement immediately** — including fixing the voice-blind refinement drift. Highest leverage per unit of work; depends on nothing else._

- Restructure all templates per **Core Concept B**: XML-tagged blocks, system/user split (real message roles, dropping the literal `===USER===` marker), precedence preamble in code, output rule hoisted into system.
- Split the single examples block into `<aspirational_examples>` + `<voice_examples>` with their distinct instructions. The aspirational block may be empty until Phase 5 — wire it to `favorite: true`.
- **Give refinements a voice anchor** (style guide + exclusions in every refine/repair/tighten prompt). This is the single most impactful change in the phase.
- Collapse chip + freeform refinement into one refine template, two entry points. (The _UI_ swap of more/less → freeform box lives in Phase 3; coordinate — the template change here anticipates it.)
- Implement intent-shape framing (fragments vs. prose) with a simple heuristic.
- Keep content slots editable in the template UI; precedence logic stays in code. Everything remains visible through the existing prompt inspector.
- **Open question to settle at build:** confirm whether intent-shape framing should be two selectable sub-templates or a single template with a variable framing line.

## Phase 2 — Bug Fixes (trust & polish)

**✅ Shipped 2026-06-11** (`fix/phase2-trust-polish`) — _pending the field pass: the overlay behaviors below are exactly the kind of thing only a live x.com session can confirm, and the build environment has none. The manual-verification list is in the build session's closing note; judgment calls are in the Build Decisions Log. Rationale graduated to `design.md` → "Pull in reply context" / "On-page overlays yield to X"._

_Contained, and they're what make the tool feel unfinished today — especially important for a publicly-built, open-source project._

- **Overlay-robustness cluster (treat as one root fix).** The selection/highlight overlay persists over X's modals (e.g. the reply pop-up), and behaves inconsistently inside X lists and on `/status/` thread URLs. Root cause is shared: the overlay doesn't track X's navigation and modal states. Lean on X's own state signals rather than tracking position independently; explore hide / send-backward behavior when a modal opens. Fixing piecemeal will whack-a-mole.
- **X-ing out of the reply-context highlight should clear context** — identical behavior to clicking the trashcan icon. _(Reconciled 2026-06-11: in code this path is wired — the overlay's dismiss button sends `content:dismiss-reply-context`, which clears the lock end to end (`slices.md` §3). The observed failures most plausibly came from the stale panel-state bug fixed in the 2026-06 hardening pass (AUDIT.md MV3-01). Re-verify in the field before building; if it still misbehaves, treat it as part of the overlay-robustness cluster above, not as missing wiring.)_
- **"Show me" CTA wiring.** When saving a tweet that's already in the corpus, the "already saved → Show me" CTA should scroll the existing item into view in the library list and flash/highlight it. _(Reconciled 2026-06-11: "currently does nothing" was stale — the CTA is partially wired: it switches to the Voice screen and flashes the row (`App.tsx` `showDup` → `flashRowId` → `voice/LibRow`). What's actually missing: no `scrollIntoView` anywhere, so an off-screen row flashes invisibly — which presents as "does nothing" — and the dedicated `flash-dup` style in `LibRow` is unreachable because the screen always routes the `'added'` highlight. The fix is scroll-into-view plus routing the dup flash.)_
- **Navigate-away-from-X overlay.** When the panel is open but the user leaves X, show a translucent "go back to X" overlay. Minor, and related to the overlay state-awareness work above.

## Phase 3 — Workbench + Draft Lifecycle

_The biggest felt improvement. Dogfooding revealed the draft view is too passive — the user wants to work a draft like clay, not regenerate it. Builds Core Concept C._

- **Direct editing in the draft view** _(the keystone — several items lean on it)_: type, delete, reformat in place. **Hand edits bypass exclusions** ("your text is ground truth — you do you"); only _model_ output (a subsequent chip/freeform/polish pass on the edited text) gets re-checked.
- **Implement the draft state model** (empty/generating/active/committed) and **timed undo (~5s)** for replacements; keep the separate one-level refinement undo.
- **Copy-to-X commits the draft** (the lifecycle trigger; sets up Phase 4).
- **≤280 toggle on an existing draft = refit, not regenerate** — preserve the draft's content, adjust only the length to the new requirement; give it a distinct UI label so it never reads as "start over."
- **Polish-pass button** — feed the current draft back for a tightening/refinement pass. (Emerged organically in dogfooding — strong signal it's real.)
- **Freeform refinement box replaces the more/less boxes** (chips stay — they earned their keep). **Paste-a-draft folds into direct editing** — pasting text into the editable draft and refining it _is_ the "dump a finished draft" mode; no separate mode switch needed.
- **"Longer" chip** to pair with "Shorter." (Trivial — a seeded chip record.)
- **Keyboard shortcut to copy the draft.**
- **Bulleted input** in the prompt box (real bullets, not typed asterisks) feeding the intent-shape framing from Phase 1.
- **New context clears the active draft**, guarded by the timed undo.
- **Small add — colon-usage anti-AI rule.** New toggleable structural exclusion for AI-ish colon constructions ("The result:", "The real leverage:"). **Default off** and **narrow** (mid-sentence colon followed by a clause — _not_ times, ratios, or lists), because colons are common in legitimate writing.

## Phase 4 — Shipped-Tweet Corpus Loop

_Sits directly on the Phase 3 lifecycle. The self-reinforcing engine: the tool gets more like-you the more you use it._

- On copy-commit, **save the committed text to the corpus as a `source: shipped` voice example.** A setting (default on) governs this, with a per-draft override — not every drafted tweet should shape future voice.
- This is **example accumulation, not behavioral mutation** — robust and fully transparent (every example is visible, editable, deletable). It is explicitly _not_ automatic learning (see _Not Building_).
- Dedupe per Core Concept A (a shipped tweet later handpicked is the same item).
- **Bundle auto-filing** (a shipped post auto-files to its source bundle) depends on Phase 6 and is additive — the loop works fully without it.
- _Optional, later:_ capture the draft→shipped diff as data that could one day power _ratified_ style-guide suggestions ("you tend to cut hedging") — offered for confirmation, never applied silently.

## Phase 5 — Star Tier + Example-Streams Sampling

*Lights up the aspirational block from Phase 1 and completes the voice model. Works on `manual` + `shipped` immediately; the curated/archive *balance* only becomes meaningful once an archive exists (Phase 7).*

- Add `favorite: boolean` to `LibraryItem`, orthogonal to `source`.
- **Star toggle** on any `manual` or `shipped` item; a **visible star count** somewhere quiet, to encourage a small, curated set (visibility is the real control — resist building favorite-ranking or bulk-starring tools, which erode the very property that makes stars useful).
- **Sampling:** guaranteed-on-top fixed N starred items (own pool, shuffled, additive to `poolSize`), per Core Concept A.
- Build the **curated/archive balance slider** (inert until an archive exists; Phase 7 activates it). _(Reconciled 2026-06-11: "built but disabled since original v1" was stale twice over — what existed was an inert `manualCorpusBalance` settings field, never a slider, never read by sampling, never surfaced in any UI; and it was deleted in the 2026-06 hardening pass as dead code (AUDIT.md ARCH-04, per the no-speculative-config rule). The slider and its sampling weight are built fresh in this phase.)_
- Enforce the **starring boundary + promotion-via-X-search + dedupe** from Core Concept A.
- _Parked micro-concern:_ if a large set of shipped stars ever drowns the oldest deliberate handpicks _within_ the starred pool, add a small guarantee for handpicked stars — only if actually felt.

## Phase 6 — Context Bundles

_The most differentiated near-term bet, and part of the wedge. Builds on the `selectExamples` seam._

- Let the user **multi-select specific tweets as the primary seed** for a post/reply, instead of sampling the general corpus. Canonical example: a "day X" series, where the new entry should read like its siblings, not like the user's average tweet.
- **Saveable, recallable bundles.** A bundle is, architecturally, a constrained `selectExamples` source.
- **Auto-update:** a new post in a series auto-files into its bundle after shipping (ties to the Phase 4 loop) — the bundle becomes a living, self-reinforcing template for a format.
- This is essentially **user-controlled manual retrieval** — cheaper, more predictable, and more transparent than automatic semantic retrieval, and it may reduce or remove the need for it. Controllable user-curated voice targeting is the opposite of the opaque tools we're differentiating against.

## Phase 7 — Archive Import + Screening (the onboarding on-ramp)

_Reframed from "eventually" to a priority: it's what makes the tool valuable on day one for a new user. Upload archive → instant corpus → drafts that already sound like you. The difference between a tool people try and a tool people keep._

- **Accept the X archive `.zip`**, locate and parse the relevant files inside (`tweets.js` / parts, `account.js` for the handle) — feel as much like a simple file upload as possible; don't make the user dig out a specific file.
- Apply the **quality-screening predicates**: emoji-only, single-word, and below-min-char already exist as tested, dormant pure functions (`src/lib/screening/` — activated here); dedupe and exclude-pure-retweets are new screens built in this phase.
- Capture **engagement/recency metadata** from the archive (`favorite_count`, `retweet_count`, `created_at`, reply metadata) — free and non-fragile. _Caveat: replies-received counts and impressions are generally not in the archive; likes, reposts, and age are._
- Store as `source: archive`, `embedding: null`. **Activates the curated/archive balance slider** (default 70/30).
- **Auto-generate a style-guide draft** from a sample of the archive as an onboarding beat. **Critical: confirm-don't-assert.** Present it as an editable draft the user ratifies ("does this sound right?"), never as asserted fact. A subtly-wrong auto-asserted style guide annoys the user _and_ silently poisons every subsequent generation. Same generate-then-confirm discipline as post/reply classification.
- _The onboarding first-run flow itself is a separate, holistic design for later._ This phase delivers the **capability** as a settings feature; it does not specify the first-run sequence.

## Phase 8 — Multi-LLM BYOK

_Cheap, low-maintenance, widens the addressable audience, and table stakes for a BYOK tool._

- A **provider-adapter interface** supporting the major LLMs (in addition to Anthropic) via BYO key.
- **Hidden unlock:** Anthropic offers no embeddings endpoint (one reason retrieval was deferred); other providers do. So this work quietly de-risks Phase 9 — multi-LLM and semantic retrieval are secretly entangled.

## Phase 9 — Semantic Retrieval _(conditional)_

_Build only if sampling + bundles prove too manual in practice. Bundles (Phase 6) may largely obviate it._

- Auto-select the most relevant voice examples via embeddings instead of shuffled sampling.
- Embeddings via **local in-browser model (Transformers.js)** or a provider endpoint (available once Phase 8 ships). Local keeps the privacy story intact at the cost of a one-time model download.
- The nullable `embedding` field, the `selectExamples` seam, and versioned IndexedDB were all reserved for exactly this — it bolts in without a refactor.

## Phase 10 — First-Class Thread Handling

_A real project with its own milestone, not a quick win. The `posts[]` draft shape was built from day one specifically so this bolts on without a refactor._

- Threads don't fit the post/reply split — they get their own mode (toggle single-post ↔ thread).
- User sets a **min/max post count** that shapes the output (tight 1–3 vs. stretched 7–9); the model won't obey perfectly, so validate the count afterward and nudge if wildly off.
- The two output rules **interact, applied per post:** ≤280 mode caps each post at 280; uncapped mode soft-caps each post (~1,000 chars) to prevent a runaway.
- **Output as ordered cards, each with its own copy button** (optional numbering toggle) — mirrors how X's native thread composer works, one tweet at a time. No clunky mega-dump.

## Phase 11 — Media / Quote-Tweet Understanding

_The most likely "I really wish it could see that" moment in real use, but genuinely hard._

- Give the tool a semantic understanding of image and quote-tweet content as reply context. Today, context capture is **text-only** (a known limitation).
- Hard parts: pulling media off X's DOM and passing it through (multimodal models can accept images, so the model side is feasible; the extraction side is the work).

---

## What We're Deliberately Not Building (and why)

_Recorded so good-sounding bad ideas don't quietly return._

- **Multi-platform expansion (LinkedIn / TikTok / Instagram).** Each is a separate, independently-breaking, fragile DOM integration to maintain forever — untenable for a solo builder. Voice doesn't transfer across registers (LinkedIn-earnest ≠ X-dry ≠ TikTok-captions), so the corpus story multiplies too. TikTok is video-first; text composition isn't even the point there. **Depth on one platform is the moat; breadth is surface-area-as-liability.** Going all-in on delighting the X user beats being "good enough" everywhere.
- **Managed "no-key-needed" paid tier (flat monthly).** Flat fee against metered, uncapped LLM usage is a gross-margin trap (and the power users torch it). It also adds payments, fraud surface, and support, and — fatally — destroys the "no middleman server" privacy story by making _us_ the middleman. _Decision: not commercializing._ (If that ever changes: usage-plus-margin or credits, never flat-rate.)
- **Agentic reply queue (auto-find threads, auto-draft, schedule at "natural" times).** Functionally this is sophisticated inauthentic-engagement tooling; platforms actively police it, and the "randomized natural-feeling times" detail exists specifically to evade detection — which is the tell. It corrodes the anti-slop trust that _is_ our core asset (it's the slop, one level up the stack). Approval also isn't actually cheap for a taste-driven user, and candidate-finding is a separate, harder product. The bottleneck doesn't move where the volume framing assumes.
- **Automatic behavioral learning (mutating model behavior from edit patterns).** We can't fine-tune frozen API models anyway, so "learning" would mean inferring patterns from edits and feeding them back — but the signal is treacherously noisy (why _did_ you change that?), it overfits to recent edits and drifts the voice, and it's the _least transparent_ feature imaginable (a system silently changing behavior), which fights the wedge. **The good version is Phase 4** (accumulate shipped tweets as examples) plus optional _ratified_ style-guide suggestions — never silent mutation.

---

## Open Decisions / Future Holistic Design

_Small or deferred, surfaced so they're not lost._

- **Onboarding first-run experience** — designed holistically later. Capabilities (archive import, style-guide generation) exist as settings features in the meantime.
- **Intent-shape framing implementation** — two selectable sub-templates vs. one template with a variable line (settle at Phase 1 build). _(Settled: single template with a variable framing line — see the Build Decisions Log pre-series entry; shipped in Phase 1, 2026-06-11.)_
- **Within-curated handpick protection** — only if drowning is actually felt after Phase 5.
- **Verify the transparency features actually shipped** — the prompt inspector, the editable prompt-template UI, and export-as-JSON are present (`src/ui/LastPromptInspector.tsx`, `src/ui/sections/PromptsSection.tsx`, `src/ui/sections/DataSection.tsx`; their engine logic is unit-tested) but unverified end-to-end in a real browser. They _are_ the no-snake-oil wedge, so confirm they work, not just that the UI gestures at them. _(Partially verified 2026-06-11, Phase 1 build: all three were re-verified at the code-path level — the inspector now renders every call in the chain from structured `lastPrompt:v2` records, the template UI edits both bodies through the same engine the pipeline uses, and the export path builds a versioned JSON download with errors surfaced. Still pending: a live-browser pass (load unpacked, generate, refine, inspect, export) — the build environment has no browser. Keep this item open until that pass happens.)_

---

## Build Decisions Log

_Append-only. Every build session that makes a recordable judgment call adds a dated entry here; correcting an earlier entry means adding a new one, never editing the old. This is where "settle at build" questions land their answers._

### 2026-06-11 — pre-series decisions (settled before the Phase 1 build)

- **Series scope:** this build series executes **Phases 1–7**. Phases 8–11 wait for a later series.
- **Source-taxonomy migration:** the current `LibraryItem.source` union — `'capture' | 'manual' | 'import'` (`src/types/library.ts`) — collapses to this roadmap's taxonomy (Core Concept A): `capture` and `manual` **merge into `manual`** (both are handpicks in Concept A's sense — one via the on-page gesture, one via paste), `import` is **renamed `archive`**, and **`shipped` is added**. The IndexedDB migration (a `DB_VERSION` bump with an appended upgrade block and a seeded-old-schema migration test, per `architecture.md`) lands in the **Phase 4 session**, where `shipped` is first written — no earlier phase needs the new union.
- **Intent-shape framing** (the Phase 1 open question): **a single template with a variable framing line**, not two selectable sub-templates. One template keeps the editable-prompt story simple (one thing to inspect and edit) and the fragments-vs-prose difference is one sentence of framing, not a structural fork. If the Phase 1 build surfaces a strong reason to flip this, flip it and record the why here.
- **System/user template-split mechanism** (explicit two-body templates vs. a formalized marker): **deliberately left open — decided during the Phase 1 build** and recorded here as a new entry. Context for that decision: the wire format is already real message roles today (`splitPrompt` → `system` parameter); the choice is purely about template storage and the editing UX, and must preserve user-customized template bodies across the change (the settings merge in `src/storage/config.ts` is the migration point).

### 2026-06-11 — Phase 1 build (prompt-assembly-v2, shipped)

- **Template-split mechanism: explicit two-body templates** (`PromptTemplate` is `{name, system, user, slots}`). The marker alternative would have kept the role boundary stringly — deletable or movable by accident inside one big textarea, silently changing what the model treats as framing. Two bodies make the boundary structural: it maps one-to-one onto the message roles, the Prompts tab shows two labeled textareas, slot validation runs across both, and the inspector's System/User blocks are the stored fields themselves rather than the output of a split function. `splitPrompt` and `SYSTEM_USER_MARKER` are deleted.
- **Migration resets customised v1 template bodies** — _this supersedes the pre-series entry's "must preserve user-customized template bodies" constraint._ A v1 body has no faithful mapping onto the new shape: the marker position doesn't decide the new slot placement, and the slot vocabulary itself changed (`examples` → `voiceExamples`, `charConstraint` → `length`, `parentSection` → `threadContext`, `previousDraft` → `draft`; `precedence`/`intentFraming`/`aspirationalExamples` are new). Preserving an old body verbatim would silently send broken prompts — worse than an honest reset. `mergePromptTemplates` (`src/storage/config.ts`) resets any stored template lacking both new fields, or with either field blank, to the current default; legacy keys drop out by iterating the new key set.
- **Template keys collapse six → three:** `reply` | `post` | `refine`. Chips, more/less steering, exclusion repair, and tighten all render through the one `refine` template; only `{{instruction}}` differs. More/less maps on via `composeMoreLessInstruction(more, less)` (one composed instruction string), so the panel's existing more/less UI survives untouched until Phase 3 swaps it for the freeform box.
- **Tag set:** `<precedence>`, `<style_guide>`, `<exclusions>` (system); `<aspirational_examples>`, `<voice_examples>`, `<thread_context>`, `<reply_context>`, `<length>`, `<intent>` (generation user); `<draft>`, `<instruction>` (refine user). `<thread_context>` and `<aspirational_examples>` collapse to nothing when empty.
- **Code-supplied prompt text lives as constants in `src/lib/prompt/defaults.ts`,** filled into slots at assembly time rather than baked into editable bodies: `GENERATION_PRECEDENCE` / `REFINE_PRECEDENCE` (the authority order), `INTENT_FRAMING` (fragments/prose lines), `TIGHTEN_INSTRUCTION`, and `buildRepairInstruction()`. Rationale: the pipeline relies on these meaning what the code thinks they mean, so they shouldn't drift via template edits — but they remain fully visible in the inspector, and a user who truly wants them gone can remove the slot from their template.
- **Aspirational pool is a parameter, not a DB field:** `assembleInitialPrompt` takes `{voice, aspirational}` pools; the orchestrator passes `aspirational: []` until favorites exist. No `favorite` field or IDB migration now — that belongs to Phase 5 with the rest of the Star tier.
- **Intent-shape heuristic** (`classifyIntentShape`): _fragments_ iff two or more non-empty lines, or a single line starting with a list marker (`-`, `*`, `•`); everything else — including empty input — is _prose_. Deliberately crude: a wrong guess costs one framing sentence.
- **`lastPrompt:v1` → `lastPrompt:v2`:** the record now stores structured per-call entries (`calls: {label, system, user}[]`) instead of one marker-joined string, and drops `repairContext` (the labels carry it — `repair (…)`, `tighten (N → target ≤280)`). The inspector renders every call in the chain verbatim. Old v1 records are simply ignored (session storage; evaporates on quit).
- **Call-count property preserved:** still at most three Anthropic calls per invocation; `src/api/anthropic.ts` changed in comments only. The stable system block stays cacheable-later — caching itself deliberately not implemented.

### 2026-06-11 — Phase 2 build (trust & polish, shipped pending field pass)

- **Overlay cluster root cause confirmed as diagnosed:** the render decision consumed only extension state (panelOpen/mode/lock) and none of X's, while painting at max z-index and re-finding its target document-wide. One fix, three judgment calls:
  - **Modal signal = `[aria-modal="true"]` only**, not bare `role="dialog"` — true modals (reply dialog, composer, lightbox) carry it; hover cards and menus don't, so they can't blink the overlays. Standards-level rather than an X test-id from memory, and it **fails open**: if X drops the attribute, behavior reverts to today's, never worse. Same posture for the dialog-scoped `findArticleByStatusId` skip.
  - **Hide under modals, not send-backward.** Send-backward means guessing X's z-stack — the exact fragile coupling the read-only posture exists to avoid. Under a modal the timeline is inert anyway; an informational highlight there is noise.
  - **SPA navigation now suppresses the lock highlight until the next user gesture** (new selection or reply-context-mode re-engage). This implements the §6 disappear-on-navigation rule that `overlay.ts`'s header always claimed and `index.ts` deliberately skipped ("no pathname tracking") — the code comment, not the constitution, was wrong. Lock storage and the panel card persist, so generation is unaffected.
  - The decision itself moved to `src/lib/overlay` (`decideOverlayVisibility`, tested); the DOM probes joined `extract.ts` with fixtures.
- **Dismiss-× reconciliation outcome:** the wiring was correct all along (both gestures converge on the same `setReplyContextLock(null)` write — the 2026-06-11 pre-build reconciliation note's suspicion holds). The _felt_ divergence was three async hops of latency plus a silent no-op in orphaned content scripts. Fix: optimistic local clear before the send; the storage write remains the single convergence point.
- **"Show me" scrolls and widens, "just added" deliberately doesn't:** the dup CTA is an explicit "take me there" (scrollIntoView center + filter→All if the row would be hidden); a fresh save flashing should never yank a user who didn't ask to move.
- **Off-X overlay needs no "tabs" permission — by construction:** chrome omits `tab.url` for hosts outside our host permissions, so `isXPageUrl(undefined) === false` makes "we can't see it" and "not on X" the same answer. We never learn where else the user browses. Accepted simplifications, revisit only if felt: the probe uses the last-focused window (multi-window edge), and the overlay also shows over the extension's own options _tab_ (it is, factually, not X); "Compose anyway" dismisses per off-X stint and re-arms on returning to X.
- **New lib areas:** `lib/overlay` (render policy) and `lib/url` (`isXPageUrl`, the match-pattern twin of `X_HOSTS` — kept in sync by adjacent comments, not yet by a shared constant; collapse them if a third consumer appears).

### 2026-06-11 — Phase 2 field pass: navigation suppression corrected to path-derived

The field pass found the highlight never returned after closing an X modal. Cause: **X's modals are URL-addressable** — Reply pushes `/compose/post` and pops back on close — so the build's sticky "navigation happened since lock" flag tripped on the modal's own URL round-trip and suppressed the highlight permanently (this corrects the suppression mechanism in the Phase 2 build entry above; the §6 intent stands). New mechanism: the content script records the **path where the lock was last affirmed** (selection push, mode re-engage, initial load fetch), and the highlight paints only while the tab is on that path. Navigating away hides it; returning — including a modal closing — restores it. Side effect, accepted as better UX: genuinely navigating away and back also restores the highlight (it disappears _on_ navigation per §6's letter; re-anchoring on return is correct context, not lingering). Also confirmed in the field and left as designed: in reply-context mode a body-click selects rather than navigates — the timestamp link (and every interactive child) still navigates, and toggling the mode off restores normal clicks.

### 2026-06-11 — Phase 2 field pass: overlays inside modals are scoped, not banned

The field pass also surfaced that the modal gate was a blanket "modal open → paint nothing," which threw out legitimate painting **on the modal's own content**: hover-previewing and lock-affirming the tweet rendered inside X's reply dialog or lightbox (selection itself kept working — the panel card updated — but with zero on-page feedback). Refined rule, replacing the blanket gate in the Phase 2 build entry: **while a modal is open, overlays paint only on modal-resident articles** (`findArticleByStatusId` gains a `'page' | 'modal'` scope; the preview requires the hovered tweet to live in the modal layer; the lock's path check is skipped while a modal is up, since the modal's URL is noise, not navigation). Never over the scrim, exactly one layer at a time. Known accepted edge: a lock affirmed _inside_ a modal records the modal's pathname, so after closing it the highlight waits for the next gesture (the card persists; re-click or re-toggle restores) — fixing that would mean guessing which pre-modal path to credit, ordering-sensitive against X's render timing.

### 2026-06-11 — Phase 2 field pass: same-tweet merge; in-modal selections anchor to the pre-modal page

Next field round: clicking the tweet _inside_ X's reply modal re-captured it "like a new tweet" — card lost the username, no highlight, nothing restored on close. Root fact: **X's modal copies are metadata-poor** (not clickable → no author links, no `/status/` anchor), so extraction legitimately reads `targetStatusId`/handle/display-name as null, and the degraded capture replaced the rich lock wholesale. Three-part fix:

- **`mergeReplyContextSelection` (`src/lib/replyContext`, tested):** a selection that is the _same tweet_ as the current lock (status-id equality when both carry one, normalized-text equality otherwise — the corpus dedupe rule reused) merges field-wise: fresh reading wins, the existing lock fills what the delivery couldn't see, media-unreadability ORs. A different tweet swaps as before. Applied at both lock-set points: the background's `content:reply-context-selected` handler and the panel's shortcut path.
- **Selection clicks affirm the clicked element directly:** a modal copy can never be re-FOUND by status id, but the user just pointed at it — the content script sets it as the lock target immediately (panel-open gated), and the keep-while-valid rule (connected + in the active layer) preserves it through state pushes and re-scans.
- **In-modal selections keep the pre-modal path affirmation** — this _supersedes the "known accepted edge" in the previous entry_: a lock push arriving while a modal is open no longer overwrites `lockAffirmedPath`, so closing the modal hands the highlight back to the underlying page. Safe against ordering because a user can't click inside a modal before the 200 ms modal probe has seen it open.

Net behavior: re-selecting the locked tweet through any of X's renderings is an _enrichment_, never a downgrade, and the highlight survives the whole modal round-trip. Genuinely-new tweets first seen inside a modal still get card-only treatment (no status id → nothing to highlight after close) — acceptable, and self-heals the moment the user clicks the tweet anywhere it carries links.

### 2026-06-11 — Phase 2 field pass: the highlight follows the lock into modals

Final refinement from the field: when X's reply modal opens and re-renders the already-locked tweet, the highlight should transfer to the modal's copy automatically — same tweet, still highlighted — instead of waiting for a click. Enabler: the lock-article search now falls back from status id to **text identity** (`findArticleByTweetText`, normalized by the same `normalizeTweetText` the merge uses — one normalizer, per conventions rule 4), since X strips the `/status/` link off modal copies. Same fallback applies in page scope, so a lock that never had a status id (first captured inside a modal) can now be highlighted wherever its text renders. The `hasLockTarget` policy input accordingly means "a lock exists," not "a lock with a status id." Accepted residual: text identity can in principle match a duplicate-posted tweet with identical text — same tolerance the merge already accepted.

### 2026-06-11 — Phase 2 field pass: truncated re-renderings still count as the locked tweet

Edge from the field: a long tweet must be expanded ("Show more") before it can be captured, so the lock always holds the FULL text — but X's modal re-renders it collapsed, and exact text identity then missed it, blocking the auto-transfer. Fix: `findArticleByTweetText` also accepts a candidate whose visible text is a truncated prefix of the lock's text, **gated on the candidate actually carrying the Show-more affordance** (`isTweetTruncated`) — a genuinely short tweet can never prefix-steal the highlight. The prefix rule is pure and tested (`isTruncatedRenderingOf`, lib/replyContext; trailing ellipsis stripped, both sides normalized). Left as designed: CLICKING the truncated modal copy still gets the "tweet is cut off" banner — capture quality requires full text; the highlight transfer doesn't.

### 2026-06-11 — Phase 2 field pass: in-modal first selections anchor to the close, not the modal

Field-confirmed the residual edge from the scoped-modals entry: turn reply-context mode on _inside_ an open modal, select the tweet there, close the modal — no highlight on the underlying page, because the first affirmation had nothing pre-modal to keep and anchored to the modal's transient URL. The earlier entry declined to fix this by _guessing_ the pre-modal path (ordering-sensitive). The actual fix needs no guess: when a lock's **first** affirmation happens while a modal is open, the anchor is **deferred** — recorded at the moment the modal closes, to whatever page it reveals. Measured, not predicted; correct by construction wherever the modal lands the user. Pre-modal affirmations still take precedence as before; the deferred flag clears on any explicit affirmation or lock clear.
