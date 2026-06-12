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

**✅ Shipped 2026-06-11** (`fix/phase2-trust-polish`) — _field-verified the same day across several live rounds (modal round-trips, list pages, truncated tweets, in-modal selection, dismiss parity, Show me, off-X overlay); the fixes those rounds produced are the dated field-pass entries in the Build Decisions Log. Judgment calls there too. Rationale graduated to `design.md` → "Pull in reply context" / "On-page overlays yield to X"._

_Contained, and they're what make the tool feel unfinished today — especially important for a publicly-built, open-source project._

- **Overlay-robustness cluster (treat as one root fix).** The selection/highlight overlay persists over X's modals (e.g. the reply pop-up), and behaves inconsistently inside X lists and on `/status/` thread URLs. Root cause is shared: the overlay doesn't track X's navigation and modal states. Lean on X's own state signals rather than tracking position independently; explore hide / send-backward behavior when a modal opens. Fixing piecemeal will whack-a-mole.
- **X-ing out of the reply-context highlight should clear context** — identical behavior to clicking the trashcan icon. _(Reconciled 2026-06-11: in code this path is wired — the overlay's dismiss button sends `content:dismiss-reply-context`, which clears the lock end to end (`slices.md` §3). The observed failures most plausibly came from the stale panel-state bug fixed in the 2026-06 hardening pass (AUDIT.md MV3-01). Re-verify in the field before building; if it still misbehaves, treat it as part of the overlay-robustness cluster above, not as missing wiring.)_
- **"Show me" CTA wiring.** When saving a tweet that's already in the corpus, the "already saved → Show me" CTA should scroll the existing item into view in the library list and flash/highlight it. _(Reconciled 2026-06-11: "currently does nothing" was stale — the CTA is partially wired: it switches to the Voice screen and flashes the row (`App.tsx` `showDup` → `flashRowId` → `voice/LibRow`). What's actually missing: no `scrollIntoView` anywhere, so an off-screen row flashes invisibly — which presents as "does nothing" — and the dedicated `flash-dup` style in `LibRow` is unreachable because the screen always routes the `'added'` highlight. The fix is scroll-into-view plus routing the dup flash.)_
- **Navigate-away-from-X overlay.** When the panel is open but the user leaves X, show a translucent "go back to X" overlay. Minor, and related to the overlay state-awareness work above.

## Phase 3 — Workbench + Draft Lifecycle

**✅ Shipped 2026-06-11** — _session 1 (`feat/draft-lifecycle`): the lifecycle spine and direct editing; session 2 (`feat/workbench-affordances`): refit, polish pass, freeform box, Longer chip, bulleted input, colon rule. Rationale graduated to `design.md` → "Work the draft like clay" / "Refine"; decisions in the Build Decisions Log._

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

**✅ Shipped 2026-06-11** (`feat/shipped-corpus-loop`) — _the taxonomy migration (IDB v3) and the loop itself; bundle auto-filing stays with Phase 6 and the draft→shipped diff capture stays optional/later, as planned. Rationale graduated to `design.md`; decisions in the Build Decisions Log._

_Sits directly on the Phase 3 lifecycle. The self-reinforcing engine: the tool gets more like-you the more you use it._

- On copy-commit, **save the committed text to the corpus as a `source: shipped` voice example.** A setting (default on) governs this, with a per-draft override — not every drafted tweet should shape future voice.
- This is **example accumulation, not behavioral mutation** — robust and fully transparent (every example is visible, editable, deletable). It is explicitly _not_ automatic learning (see _Not Building_).
- Dedupe per Core Concept A (a shipped tweet later handpicked is the same item).
- **Bundle auto-filing** (a shipped post auto-files to its source bundle) depends on Phase 6 and is additive — the loop works fully without it.
- _Optional, later:_ capture the draft→shipped diff as data that could one day power _ratified_ style-guide suggestions ("you tend to cut hedging") — offered for confirmation, never applied silently.

## Phase 5 — Star Tier + Example-Streams Sampling

**✅ Shipped 2026-06-11** (`feat/star-tier`) — _favorite flag (IDB v4), the boundary-enforced star toggle, the quiet count, the guaranteed star pool feeding `<aspirational_examples>`, and the curated/archive tier math (slider inert until Phase 7). The parked within-star handpick guarantee stays parked. Rationale graduated to `design.md`; decisions below._

*Lights up the aspirational block from Phase 1 and completes the voice model. Works on `manual` + `shipped` immediately; the curated/archive *balance* only becomes meaningful once an archive exists (Phase 7).*

- Add `favorite: boolean` to `LibraryItem`, orthogonal to `source`.
- **Star toggle** on any `manual` or `shipped` item; a **visible star count** somewhere quiet, to encourage a small, curated set (visibility is the real control — resist building favorite-ranking or bulk-starring tools, which erode the very property that makes stars useful).
- **Sampling:** guaranteed-on-top fixed N starred items (own pool, shuffled, additive to `poolSize`), per Core Concept A.
- Build the **curated/archive balance slider** (inert until an archive exists; Phase 7 activates it). _(Reconciled 2026-06-11: "built but disabled since original v1" was stale twice over — what existed was an inert `manualCorpusBalance` settings field, never a slider, never read by sampling, never surfaced in any UI; and it was deleted in the 2026-06 hardening pass as dead code (AUDIT.md ARCH-04, per the no-speculative-config rule). The slider and its sampling weight are built fresh in this phase.)_
- Enforce the **starring boundary + promotion-via-X-search + dedupe** from Core Concept A.
- _Parked micro-concern:_ if a large set of shipped stars ever drowns the oldest deliberate handpicks _within_ the starred pool, add a small guarantee for handpicked stars — only if actually felt.

## Phase 6 — Context Bundles

**✅ Shipped 2026-06-11** (`feat/context-bundles`) — _the bundle store (IDB v5), creation/management on the Voice screen, the compose-side voice-seed picker, bundle-seeded sampling through the `selectExamples` seam, and auto-filing on the Phase 4 loop. Rationale graduated to `design.md` → "Context bundles"; decisions in the Build Decisions Log._

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
- **Recency bias, archive tier ONLY** _(decided 2026-06-12, ahead of the build)_: the archive top-up favors recent tweets (recency-weighted or recent-first ordering inside the tier) — a **fixed, documented policy, not a user knob** (a weight slider would be pseudo-control: its effect is invisible in any single generation). Rationale: age proxies staleness only for the bulk import the user never individually vouched for; the curated tiers stay age-blind because stars/deletes/handpicks are explicit current judgments that beat any proxy, and a silent reweighting there would second-guess curation and hurt inspectability. Implementation notes: weight by the tweet's own `timestamp` (never `createdAt`); manual pastes carry paste-time timestamps, so treat synthetic/missing dates conservatively — but those are curated anyway, so the policy shouldn't touch them. Slots inside the archive tier's ordering without changing the `selectExamples` seam.
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

**✅ Shipped 2026-06-12** — _pulled ahead of Phases 7–9 by explicit decision (the pre-series "Phases 1–7 first" sequencing is superseded for this one phase; 7–9 remain next). Four sessions: data+brain (`feat/thread-data-and-brain`), lifecycle+pipeline (`feat/thread-lifecycle-pipeline`), compose UI (`feat/thread-compose-ui`), capture+library (`feat/thread-capture-library`). Scope grew beyond the original composition-only framing: threads are a first-class LIBRARY entity too (capture, storage, sampling, display). Decisions in the Build Decisions Log._

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

### 2026-06-11 — Phase 2 field pass: orphaned scripts now self-teardown

A field round reported "the picker stopped working entirely — hover paints, clicks pass through to X." That is the exact fingerprint of an **orphaned content script**: reloading the extension (every build round) cuts the old script in open tabs off from messaging; its hover painting kept working off frozen local state while its click handler correctly bailed on `isAlive()` — _before_ `preventDefault`, so clicks fell through to X. Not a regression in the prior commit (which touched only lock-anchoring state); the remedy is reloading the x.com tab after loading a build. Hardening shipped so the state is self-evident instead of confusing: the hover handler now probes `isAlive()` too, and the rAF loop tears down every overlay and stops permanently once the probe fails — an orphan disappears (§6 teardown) rather than half-working.

### 2026-06-11 — Phase 2 field pass: path anchoring removed; the highlight follows the locked tweet

Two more field rounds settled it. (1) Truncated modal copies still didn't match the expanded lock text: X nests the literal "Show more" label inside the tweet-text node on some renderings, so the visible text ends "…Show more" and the prefix check failed — `isTruncatedRenderingOf` now strips the label, and the finder accepts a trailing truncation ellipsis as evidence when the Show-more control itself isn't detectable. (2) The deferred-anchor scheme broke on yet another variant (X can close a modal onto an intermediate page, e.g. `/status/X`, re-breaking the anchor). That made it three path-anchoring designs in a row — sticky flag, path-affirmation, deferred affirmation — each killed by a different way X pushes and pops URLs. **Decision: delete path anchoring entirely.** The lock highlight now attaches to the locked tweet itself wherever the active layer renders it (id, then text identity); it vanishes with views that don't render the tweet and re-attaches on views that do. Modal scoping, panel gating, mode gating, dismiss/clear, and orphan teardown all unchanged. CLAUDE.md §6's disappear-on-SPA-navigation bullet was _clarified in place_ (per the never-silently-diverge rule): the highlight disappears with the old view and may re-attach **only to the locked tweet itself** — re-derivation from live state, never lingering. Net: ~60 lines of three-times-wrong state machinery deleted; every reported flow works by construction.

### 2026-06-11 — Phase 3 session 1 (lifecycle spine + direct editing, shipped)

Phase 3 splits across two sessions; this one built Core Concept C's spine. The remaining affordances (refit, polish pass, freeform box, Longer chip, bulleted input, colon rule) are session 2 — their seams are the reducer's event vocabulary and the editable surface. Judgment calls:

- **The state machine is a pure reducer** (`lib/draft/lifecycle.ts`) — brain/shell applies to state machines: the panel only dispatches. The stale-request gate moved INTO the reducer (only the newest in-flight seq lands; tested), with the panel's `requestSeq` ref kept solely to number requests and skip stale error toasts.
- **Highlights vs editable surface: backdrop mirror, cleared on first hand edit.** The draft is always a real textarea (native caret/paste — pasting a finished draft IS the dump-a-draft mode); while residual violations exist, a metrics-identical backdrop paints the marks behind the glyphs. The first keystroke clears them permanently for that text — recompute-on-idle was rejected because it would re-CHECK user text, which "hand edits bypass exclusions" forbids. Metric drift between the layers can only ever show before the first keystroke.
- **"New context" defined**: a lock arriving for a different tweet than the immediately-previous lock, judged by the merge's same-tweet identity (`isSameTweet`, now exported). Same-tweet re-deliveries are enrichments, not new context; clearing the lock is not new context (the draft stays). Edge accepted: re-capturing the same tweet after an explicit clear reads as new (nothing to compare against) — the timed undo guards it.
- **Adoption semantics**: touching a just-replaced draft (hand edit or starting a refine) drops the timed-undo snapshot — "the replacement stands if touched". Commit resolves both undo scopes. A restored (undone) draft always comes back `active`, even if it had been committed. A failed generation returns to the prior draft, or to the empty workbench when there was none (behavior change: first-generate errors no longer show an empty draft card).
- **Copy shortcut: ⇧⌘↵ / Ctrl+Shift+Enter**, panel-scoped, shown on the button. Pairs with the existing ⌘↵ (generate / apply steer), and deliberately not Ctrl+Shift+C, which Chrome owns (devtools inspect). The ⌘↵ handlers now ignore shifted presses so the two never both fire.
- **Commit hook shape**: a panel-side emitter in `lib/draft/commit.ts` (`onDraftCommit`/`emitDraftCommit`) carrying `{text, mode, handEdited, committedAt}`. Wired to nothing — Phase 4 subscribes and forwards to the background for `source: shipped` capture. Lifecycle-committed (state) and corpus-committed (event) stay separate facts per Concept C.
- **Timed-undo snapshot is in-panel state only** (per spec): a panel close during the ~5 s window means the replacement stands.

### 2026-06-11 — Phase 3 session 1 field pass: new context clears the angle too

Field-confirmed: a new-context clear left the old angle ("your angle") text in place, even though it was written for the previous tweet. Now the angle clears with the draft, and the timed undo restores both atomically — the `ReplacementSnapshot` carries `bullets` (non-null only for new-context clears; a regenerate keeps the angle on screen, so its snapshot has nothing to restore). Deliberately scoped to draft-clearing new-context events: an angle typed in advance of selecting the first tweet is never touched. Also hardened the ⇧⌘↵ copy shortcut to capture-phase and labelled its hard constraint in the UI — key events and clipboard writes only exist for the focused document, so the shortcut works exactly when the panel has focus (that is a browser rule, not a binding choice).

### 2026-06-11 — Phase 3 session 1 field pass, round 2: whole-workbench undo; the copy binding is Ctrl

Two more field findings. (1) Undoing a new-context clear restored the draft and angle but left the NEW lock in place — the card showed the new tweet's author over a draft written for the old one. The replacement snapshot now carries the whole workbench (`{bullets, replyContext}`, present only for new-context clears), and one Undo restores draft + angle + the previous lock atomically — including restoring to no-lock when the original draft was a post. The lock restore echoes back through the lock subscription, so a one-shot suppression keeps the restoration from reading as yet another new context. (2) ⌘⇧↵ never reaches the panel's keydown on macOS Chrome (consumed upstream) while ⌃⇧↵ arrives fine — field falsified the assumed binding, so the shortcut is officially **Ctrl+Shift+Enter on every platform**, the button label now says ⌃⇧↵, and metaKey stays accepted opportunistically.

### 2026-06-11 — Phase 3 session 2 (workbench affordances, shipped)

The six remaining Phase 3 items, each one refine-shaped feature flowing through the single Phase 1 refine template. Judgment calls:

- **Colon rule is narrow by construction, not by tuning**: 1–4 letter-only words before the colon (digits can never match → times/ratios safe), space+letter after on the same line (end-of-line lead-ins and `://` safe), no comma/colon in the trailing clause (inline enumerations safe). Known accepted false negative: "The result: faster ships, happier users" (comma in clause). Default OFF — even narrow, colon style is too personal to police unasked. No auto-fix: rewording is a judgment, so residue goes to repair / hand edit.
- **Default-chip seeding is tracked, not inferred**: `seededChipIds` records which defaults an install has been OFFERED, so 'longer' seeds exactly once into existing installs (inserted after its surviving predecessor, 'shorter') and a deleted seed stays deleted forever. Installs predating the field are treated as having been offered the original three. The merge stays a pure read-path function — the seed list persists on the next natural settings write.
- **Polish preserves length by instruction** ("tighten phrasing… do not change its meaning, stance, or overall length") — squeezing under 280 is the refit's job, and giving each pass one job keeps both predictable.
- **Refit guards**: fires only over an ACTIVE draft that actually measures >280; flipping OFF is inert; pre-draft the toggle is just a setting; a committed draft is left alone (regenerate/edit reopens it). The refit passes its cap value into the request explicitly — the toggle flip and the refine share a tick, before React state re-renders. Distinct labels everywhere ("same draft, shorter") per the never-reads-as-start-over requirement.
- **Freeform replaced more/less with zero compatibility shim**: RefineKind is in-flight only, so 'moreless' simply ceased to exist; `composeMoreLessInstruction` and its tests were deleted rather than deprecated. Inspector labels carry the new kinds verbatim.
- **Bullet mode is a per-session input affordance, not a setting**, and its signal is explicit: `bulletedInput` on the request forces the fragments framing rather than letting `classifyIntentShape` re-derive it from text that happens to contain glyphs. Toggling upgrades typed `-`/`*` markers to real `•`; Enter inserts the next bullet via `setRangeText` so the caret stays native.

### 2026-06-11 — Phase 3 follow-up: the cap wins over "Longer" — and the prompt now says so

Settled the Longer-vs-≤280 interaction: **the cap is a constraint, the chip is a direction; constraints win.** "Longer" with the cap on means longer-but-still-under-280; wanting genuinely longer is what flipping the cap off is for. The mechanical fix behind it: refine prompts carried no length information at all, so "Longer" at 250 chars made the model write past the limit and the silent tighten backstop crushed it back — sometimes shorter than the start, making the chip look broken. With the cap on, every refine instruction (except the refit, which states the limit itself) now appends the same 280 line generation uses, so the model aims at the headroom. Prevention-first, backstop unchanged.

### 2026-06-11 — Phase 3 follow-up: bullets are detected, not toggled

Field feedback on the same-day `• bullets` minitoggle: a mode toggle is the wrong shape for this — the user's own typing habit (`- ` at the start of a line) already announces the intent. _Supersedes the bullet-mode entry above._ The toggle is gone; instead the space keystroke after a lone `-`/`*` at line start converts it to a real `•` in place (setRangeText, native caret; `normalizeTypedBullets` is the length-preserving paste safety net), Enter continues the list, Enter on an empty bullet ends it, Shift+Enter escapes to a plain newline. `bulletedInput` is now derived — any bullet line present — rather than stored mode state. A placeholder hint advertises the gesture.

### 2026-06-11 — settled: chips are directions, baked controls are verbs

Considered promoting Shorter/Longer to baked-in controls alongside Regenerate/Polish/Undo. **Declined — they stay chips.** The taxonomy: baked-in controls are _workflow verbs_ whose instruction wording the pipeline mechanically relies on (refit must preserve content, polish must preserve length, repair must reference violations, precedence orders the whole prompt) — code constants because editing them could silently break machinery. Chips are _content directions_ the pipeline never depends on — and prompt text the system doesn't depend on should be user-editable, per the honest-wrapper ethos. Shorter/Longer pass the chip test: deleting them breaks nothing (the cap is enforced by refit + tighten regardless), the cap line is appended in code around whatever the chip says (edits can't defeat constraints), and they get intensity escalation from chip machinery for free. The seeding cost of user-owned chips is already paid, and "Reset to defaults" recovers deletions.

### 2026-06-11 — Phase 4 build (taxonomy migration + shipped loop, shipped)

- **Migration passes now run sequentially, one named function per schema version.** Adding the v3 pass exposed a real hazard the old append-a-block pattern hid: two concurrent cursors over the same store interleave row by row, and `cursor.update` writes the FULL row that cursor read — the later pass's stale read silently erased the earlier pass's backfill (the existing v1→v2 test caught it immediately). The never-edit-an-existing-migration rule survives reworded: add a pass function, never edit one; each pass kept its logic verbatim and the seeded tests pin both transitions.
- **One text normalizer everywhere**: the corpus dedupe reuses `normalizeTweetText` from the reply-context merge (trim + collapse internal whitespace, case-sensitive — same tweet renders with the same case), so "the same tweet" means one thing in the lock and in the library.
- **Record identity vs tweet identity**: dedupe matches by tweet id (a captured record's id IS its status id) or normalized text, but a merge never moves the storage primary key — the existing record updates in place, keeping its id and `createdAt`. A shipped row (uuid id) later handpicked (status id in hand) is found by text and promoted to 'manual' under its original key.
- **Skips are eligibility, not errors**: the shipped save silently does nothing when the setting is off, the handle is unset, or the text is empty — the user's copy already succeeded; this is downstream bookkeeping. A genuine messaging failure does surface ("Copied — but saving it to Voice failed.").
- **The per-draft override is opt-out only and hides when the global switch is off** (nothing to override). It resets to the setting on every new generation, not per refine — refines reshape the same draft.
- **The duplicate banner now points at the existing record** (`duplicateOfId` = the real row), so "Show me" lands on the item that actually lives in the library — previously it carried the incoming id, which for a text-match duplicate of a uuid row pointed at nothing.
- **'shipped' is visible**: library rows wear a `shipped` chip (the loop should be observable, not silent accumulation); manual rows stay unbadged as the norm.
- **Manual paste of already-present text refreshes in place and reports success** — the item is in the library either way; the list refresh shows it.

### 2026-06-11 — Phase 5 build (star tier + sampling, shipped)

- **The star cap is `floor(poolSize / 2)`**: stars are additive to the pool, so this bounds them at one third of the total examples in any prompt — the canon raises the bar without averaging the range away. The `starCount` slider runs 0–8 (0 = stars off entirely; default 4).
- **`curatedArchiveBalance` is stored as a 0..1 fraction** (default 0.7), rendered as a 70/30 percentage slider. The tier math is mutual top-up: curated fills to its share first, archive tops up the remainder, and whatever archive can't supply flows back to curated — so zero archive items reproduces the pre-tier curated-only behavior exactly, and the slider stays honestly disabled (with a note) until Phase 7 imports something.
- **Stars over budget aren't lost**: a starred item not selected for the aspirational pool remains an ordinary candidate for the voice sample. Only the SELECTED stars are excluded from voice (the no-item-twice rule).
- **The favorite flag rides the existing record through merges**: dedupe promotions (`shipped`→`manual` on handpick) keep the star — favorite is the user's judgment, orthogonal to source — pinned by a dedupe test.
- **The sampler defensively excludes favorited archive rows** from the star pool even though the UI boundary makes them impossible — the rule is encoded where it matters, and such a row still samples normally as archive.
- **The within-star handpicked guarantee stays parked** per the roadmap — build only if drowning is actually felt.

### 2026-06-11 — Phase 6 build (context bundles, shipped)

- **Storage: a `bundles` object store in the corpus DB (v5), not a parallel database.** `Bundle = {id (uuid), name, memberIds (ordered), createdAt}`, referencing items by id, never copying them. The v5 migration creates the store only — no row rewrites, so no migration pass function; store creation is synchronous inside the versionchange transaction. `EXPORT_SCHEMA_VERSION` rides `DB_VERSION` to 5 and the JSON export now carries a `bundles` array (a backup that silently dropped curated series would be a data loss), and **clear-all wipes both stores in one transaction** — half a wipe would leave bundles full of dangling ids.
- **Dangling member ids are tolerated AND retained.** Deleting a library item does not rewrite bundles: the library delete's undo toast restores the same id, so eager cleanup would break it. Resolution (`lib/bundles` `resolveBundleMembers`) drops missing ids at use; the UI surfaces an honest count ("3 members · 1 missing") instead of absorbing the loss silently.
- **A bundle IS the voice pool — verbatim.** When a bundle seeds a generation, its resolved members fill `<voice_examples>` exactly: bundle order (no shuffle), no post/reply mode filter (the user picked every member; silently dropping some over classification would be opaque), no cap, and **no top-up from the general pool when it runs under budget** — the bundle is the PRIMARY seed and user-controlled targeting beats automatic breadth. Over budget the same logic holds: every member goes (an explicit selection is its own budget; bundles are hand-built and small). An empty or all-dangling bundle runs with zero voice examples — visible in the picker count and the inspector, deliberately not an error.
- **Aspirational stars still ride on top of a bundle-seeded generation** — the bar is the bar regardless of where range comes from — minus any star that is itself a bundle member: the no-item-twice rule resolves in the bundle's favor (the bundle keeps its members; the star pool draws from the rest).
- **Member order = selection order at creation; auto-filed items append.** The Voice screen's pick badges number the selection so the stored order is visible while it's being made. Never re-sorted.
- **A deleted bundle errors at GENERATION, skips at FILING.** Generate with a just-deleted bundle returns an honest `bad-request` ("That bundle no longer exists…") — never a silent fallback to sampling, because the user asked for a specific seed. But at commit time a deleted bundle skips silently, per the Phase 4 eligibility-not-error posture: the copy and the shipped save both already succeeded; there is simply nothing left to file into. The draft-state note follows the same fact: it hides when the seeding bundle is gone, since "copying files it back" would no longer be true.
- **The seed is threaded explicitly, end to end, never inferred:** `GenerationRequest.bundleId` → the lifecycle's `DraftContent.seedBundleId` (the reducer stamps it on a generate, carries it through refines and hand edits — they reshape the same draft — and the timed undo restores it with the draft) → `DraftCommit.seedBundleId` → `panel:draft-committed.bundleId` → `handleShippedDraft`, which appends the **saved record's id** (the existing row on a dedupe merge, so the bundle points at the item that actually lives in the library) and broadcasts `bg:bundles-changed`.
- **Auto-filing rides the Phase 4 loop's gates** (the global setting and the per-draft override): a shipped save that's skipped files nothing. Already-a-member is a no-op via `appendBundleMember`'s identity return.
- **Transparency:** the inspector label carries the seed (`generate (bundle: <name>)`), the bundle members are the literal `<voice_examples>` content of the recorded call, the compose UI states the seed in both states (picker + footer pre-draft; a quiet note over an active seeded draft), and picker counts are RESOLVED member counts — what would actually be sent.

### 2026-06-11 — Phase 6 follow-ups (dogfooding round, shipped)

Same-day feedback on the Phase 6 build; six changes, each a judgment call worth recording:

- **The Voice screen restructured into two parallel collapsible sections** — Bundles and Saved examples, one header pattern (chevron + title + count + the section's own action button). The "New bundle" entry had been a stray button in the examples filter row — a creation affordance living outside the section it creates for; it's now the Bundles section's +, present even at zero bundles. Bounded real estate: the bundle LIST gets a max-height with internal scroll (it sits above the examples and must never shove them off-screen); Saved examples keeps the page scroll as its bound — a nested scroller on the panel's principal list would be worse than the problem it solves.
- **Bundle members link to their library rows**, reusing the duplicate banner's "Show me" path verbatim (scroll into view + flash + filter widened + section opened). The flash kind was renamed `'dup'` → `'locate'` — two callers now share it, and a name that describes one of them lies about the other.
- **The voice-seed picker joined reply context in a "grounding cluster"** above the angle box, in both compose states. They answer different questions (what to react to vs what to sound like) but the user experiences both as concrete anchors attached before typing — and the picker previously sat orphaned in the tools row.
- **Member reorder is up/down arrows, not drag.** Order soft-matters (members render as a numbered sequence; a series reads chronologically), so it gets a control — but in a ~320px panel with 3–15 rows, drag is jank and code for no win; arrows are simple, durable, and keyboard-accessible by construction. The pure move (`moveBundleMember`) steps one VISIBLE position: a dangling id between two live members keeps its slot and never swallows the move.
- **Auto-filing gained a per-draft override (default on), no global setting.** The driving case: borrowing a bundle's voice for a one-off ("in the Day X voice, but not a Day X entry") would pollute the series. The control is the seeded-draft note's filing text turned into a switch — visible exactly when a save will actually happen — mirroring the Phase 4 per-draft ship-to-voice pattern. Deliberately no settings field: nothing asks for "never auto-file", and a field nothing reads is the dead config this repo already deleted once (ARCH-04).
- **Capture (and manual paste) can file straight into a bundle.** The capture banner gains an optional target ("Also file into …"); every save while it's set — fresh or dedupe-merged, which makes re-capturing an already-saved tweet the Concept A promotion gesture with bundling attached — also joins the bundle, and the save banner states it ("Filed into …"; the side effect is never silent). The target lives in session storage (`captureBundleTarget:v1`) PAIRED with capture mode: they live and die together, and turning capture off clears it. The library-row-first invariant holds — bundles reference, never copy; this is a one-gesture shortcut, not a bypass. A deleted target bundle skips filing silently (same eligibility posture as shipped filing) and the UI resets the select.

### 2026-06-11 — Phase 6 follow-ups, round 2 (dogfooding, shipped)

- **Empty bundles are valid.** Save needs only a name; picks are optional. The from-X workflow demands it: create "Day X" empty, set it as the capture target, go clicking — requiring a member up front made the two features circular. Everything downstream already treated empty honestly (zero voice examples, stated in the row and the picker).
- **Picks can target an existing bundle.** The selection bar gained a destination select (new vs existing — typed `string | null`, null = new), and each bundle row a + that starts picking pre-targeted. Rows already in the destination show a **locked check** ("Already in this bundle") instead of being silently dropped at save; retargeting prunes overlapping picks so the count stays honest. Appends land at the end, where the arrows rearrange. This closed the gap where library items had no path into an existing bundle at all.
- **The filing selects mint bundles inline.** "+ New bundle…" in the "Also file into" selects (capture banner, paste form) swaps in a name field and creates an empty bundle as the selection — no detour through the Bundles section. One shared `BundleTargetSelect` backs both call sites (a second consumer — the abstraction earns its keep), and the banner's select now shows whenever capture is on: zero bundles is exactly when minting one matters.
- **Double-saves report success; duplicate wording tells the truth.** Field report: "already in your voice" over a genuinely new save. Two root causes found in code, no third: a double-click captures twice, and the second pass — via the dedupe scan or the id-collision net (which by construction only fires for a row inserted moments earlier; an older row would have matched the scan) — replaced the success banner with the duplicate warning. Fix: a duplicate within a **5 s grace** of the record's creation reports the success it was, idempotently. Separately, a text-match against a `shipped` row was described as "you saved this before" when the LOOP saved it — the notice now carries the pre-merge source (`duplicateOfSource`) and the banner says "matches a draft you shipped from Margin — now marked as handpicked" (plus an archive variant ready for Phase 7).
- **Copy's side effects live in one "On copy" row** at the foot of the draft card: the save-to-Voice switch and the file-into-bundle switch side by side, replacing the draft head's lone "voice" toggle and the switch embedded in the seed note (which returns to pure provenance). The bundle switch renders **disabled, not hidden, when voice saving is off** — the dependency (no save → nothing to file) stays visible instead of the control vanishing.

### 2026-06-11 — Voice-screen live search (shipped)

- **Search the saved examples, filtering as you type**, composed with the pill filter (visible = pill ∩ query). Matching is **token-AND, case-insensitive substring per token** (`matchesSearch`, lib/library, tested) — "validation trap" finds a tweet containing both words anywhere, and there is deliberately no fuzziness or ranking: the user can always see why a row matched.
- **Pill counts stay whole-library** while searching — they're the stable overview; the whittling list is the search feedback. A dry search names the query (and the narrowing pill, when one is on) with a clear-search action.
- _Superseded same day (dogfooding):_ **pill counts now follow the query** — faceted-search semantics, showing how the matches split across types ("All 4 · Posts 3 · Replies 1" while searching). The whole-library numbers read as wrong next to a whittled list. What still follows the library: the **starred pill's visibility** and the stuck-filter reset — both keyed to the absolute star count so typing can't blink the pill away or yank an active starred filter to All mid-search.
- **Locate clears the query** along with widening the filter and opening the section — a reveal that lands on a row hidden by a stale search would be the same invisible-flash bug class fixed twice before. Escape clears; Chrome's native ×-cancel handles the rest (no custom clear button).

### 2026-06-11 — reply-context card clamps long tweets (shipped)

- A lengthy captured tweet dominated the panel's vertical space. The card now clamps the tweet to **6 lines** (the earlier-in-thread block to **3**) with an X-style accent **Show more** that expands in place and offers Show less — the LibRow convention reused, link rendered only when the text actually clamps, expansion reset when the lock swaps tweets. **Display-only**: the lock holds, and the prompt receives, the full text always — this is unrelated to the capture-time "tweet is cut off" gate, which still requires expanding on X before capture.

### 2026-06-12 — Phase 10 build (first-class threads, shipped)

User-settled design (recorded from the planning round): threads are **atomic library items** (`type: 'thread'` + identity-bearing `segments[{text, statusId}]` — deliberately NOT metadata over constituent post/reply rows, which would pollute reply sampling, invite hole semantics, and force grouping UI); capture is the **visible self-reply spine walk** + a `---` paste fallback; **posts-only** in v1 (reply context forces single-tweet mode); sampling is **threads-first with post top-up on a tweet-equivalent budget**; length control is **"1+3+repack"** (soft ≈N stepper + holistic chips + repack-on-target-change). Build-time judgment calls:

- **The `---` wire format is THE one segment encoding** (lib/thread, parse/join inverses pinned): model output, the refine `{{draft}}`, `LibraryItem.text`, `DraftCommit.text`, and the paste form all speak it. The parser is tolerant (whitespace, longer dash runs, accidental `1/`-numbering stripped narrowly so "2024 was…"/"10/10…" survive); a model that ignores the format parses as one segment and the count validation catches it — the reshape call restates the format (designed recovery).
- **The call ceiling held at ≤3** — initial + one repair + one RESHAPE. Thread repair folds the count nudge in when both fired (one combined instruction); the reshape composes tighten-the-named-posts and/or count-nudge. Count validates only on generates and repacks (|actual − target| > 1) — chips/freeform/polish are holistic and may legitimately change the count. Thread invocations get **4096 max output tokens** (1024 truncates mid-thread); surfacing `stop_reason` stays an accepted gap.
- **The post-copied commit rule.** `'committed'` was replaced by `post-copied(i)`: a draft commits when EVERY post has been copied since its text last changed — singles are the N=1 case (one Copy commits immediately, behavior identical). Editing a copied post resets ITS flag; fresh model output resets all. The corpus event now fires from the committed-TRANSITION (one emission point; re-copying an unchanged committed draft doesn't re-fire).
- **Stars in thread mode**: starred POSTS stay the aspirational pool (the prose bar, register-appropriate); starred THREADS get guaranteed-first placement within the thread fill — never joined into the aspirational block. (Resolves the planning agent's "no stars in thread mode" against the user-approved "stars ride on top".)
- **Budget rules in the thread fill**: the first thread is always taken even over budget (zero thread exemplars while they exist would be worse than an overshoot); non-fitting threads skip individually and the walk continues; `segments.length ?? 1` is the debit (defensive on null).
- **The spine walk degrades, never guesses**: status-pages only; up-walk to the root, down-walk the contiguous same-author run; the first foreign article or spacer cell stops it (which is exactly what excludes others' replies AND the author's replies-to-replies); a root that is itself a reply (Replying-to marker or foreign parent directly above) is a THREADED REPLY → single capture. Only rendered segments are read (virtualization) — the banner reports the honest count with a scroll hint. Any truncated segment blocks capture.
- **Thread dedupe tiers**: record id → segment status id → whole text → segment text. A single tweet never merges INTO a thread (identity return — promoting one segment would corrupt the entity; the banner still points at the thread row); a captured thread upgrades a previously-captured single root in place; thread-over-thread merges fresh-read-wins, segments included.
- **Repack mirrors the refit**: the ≈N stepper over an active thread fires `refine (repack to ≈N)` same-tick (content fixed, packaging changes); flipping the cap ON over a thread with over-cap posts fires the per-post `THREAD_REFIT_INSTRUCTION`. The ⌃⇧↵ shortcut and the big button copy the FIRST UNCOPIED post ('Copy 2/5') — the sequential paste-into-X workflow.
- **Library treatment**: 'thread · N' chip; collapsed rows show the first post clamped; expanded rows show connected segment blocks; the inline editor is one textarea per post, TEXT EDITS ONLY in v1 (no add/remove/reorder/type-conversion — structure ops are deferrable, editability of every saved word is the ethos). The Threads pill appears once any thread exists, counts search-faceted like the rest.
- **`classifyType` deliberately unchanged**: a single capture of one's own self-reply still classifies as 'reply' — the spine walk assigns `type: 'thread'` explicitly and never consults it. Not a mismatch; don't "fix" it.
- **Pasted threads need ≥2 parsed segments** — an honest error, never a silent single save. Shipped threads save with null segment ids (nothing is posted yet); a later handpick of the published thread upgrades the record in place.

### 2026-06-12 — Phase 10 field pass: the walk crosses junk cells; partial threads upgrade

Field-found: capturing mid-thread saved the thread WITHOUT its root. Cause: conversation pages interleave article-less cells between posts — most notably the inline "Post your reply" composer directly under the focal tweet — and the spine walk treated any article-less cell as a hard stop (a rule designed for feed-style spacers). _Supersedes the "spacer stops the walk" fixture:_ the walk now steps to the nearest ARTICLE-BEARING cell in both directions, skipping junk; the **foreign-author article remains the boundary** (it still excludes other people's replies, replies-to-replies, and reply-roots — the threaded-reply check now also sees through junk). Second fix in the same pass: thread-capture dedupe now falls back to **per-segment identity** — a fuller re-capture finds and upgrades an earlier PARTIAL capture of the same thread (whose record id is a different segment's id), and a previously hand-captured single segment promotes into the thread instead of duplicating. Display "naming" needed no change — rows always show the first captured segment; with the root captured, that IS the first post.

### 2026-06-12 — scoped thread refines (per-card Rewrite + the steer scope, shipped)

Dogfooding ask: act on ONE post of a thread, not just the whole. Decisions:

- **In addition to the thread-level controls, never instead.** Holistic refines are where thread coherence lives (handoffs, pacing — the things thread examples teach); full Regenerate is thread-level by nature (it resamples). Per-card actions serve precision: protect the four good posts, redo the dud.
- **Scoped means scoped by code, not model obedience.** A scoped call sends the WHOLE thread for context (no token savings — it's about precision, not price) and asks for the whole thread back; the pipeline count-guards the parse against the previous draft (mismatch = honest failure: "didn't keep the change to one post"), extracts the one post, runs the single-mode backstops on it alone, and the reducer's `post-replaced` event splices it — resetting only THAT post's copied flag (copied siblings stay checked; their text genuinely didn't change).
- **Refine controls aren't cloned per card — they gain ONE scope.** A card's Aim button points the existing chips + steer box at that post, shown twice (accent ring on the card, a pill above the refine blocks with a clearing ×). Scope hygiene: cleared on generate/discard, un-aimed when its post disappears, re-validated at use.
- **No per-card undo, on principle.** The global one-level Undo reverses a scoped refine exactly (the snapshot is the whole draft); a per-card undo button would visually promise per-card HISTORY we don't keep — an affordance implying state that doesn't exist.
- Rewrite is a code-supplied instruction ("fresh take — same beat in the thread's flow; keep what it sets up and hands off intact"), labelled `refine (rewrite post N)` in the inspector.

### 2026-06-12 — the voice-seed picker is always visible (zero-bundles empty state)

Dogfooding found the original call wrong: hiding the picker until a bundle exists ("a power feature stays out of the default path") meant the feature was undiscoverable exactly when the user had no bundles — the only state where they need pointing at it. Reversal: `BundlePicker` always renders in the grounding cluster. With zero bundles the select shows its one truthful option ("Sampled from your library" — which IS the live behavior, so the control isn't disabled or lying) plus a quiet `.help` hint: create a bundle in Voice to hand-pick what shapes a draft. No navigation plumbing — the screen switch is one corner button away. The `bundlePicker` prop drops its null arm (the null case meant only "no bundles", now an in-component state).

### 2026-06-12 — the Done exit (completion is not discard)

Dogfooding: after shipping a tweet, the only way back to a neutral bench was the trash can — wrong position (up in the brief bar, secondary to the draft) and wrong semantics (success isn't disposal). The fix recognizes TWO exits that mean different things:

- **Abandon** (the trash, unchanged): the draft text is lost — destructive, so a trash can in a secondary position is honest for it.
- **Complete** (new): once committed, the draft is already saved/filed, so clearing it destroys nothing — it earns a confident primary button, **"Done — next draft"**, appearing exactly when the lifecycle crosses into `committed` (the state already existed; the UI just never cashed it in).

Decisions:

- **`done` is a lifecycle event, committed-only.** The reducer is the authority: from any other phase it's ill-timed and ignored. It reuses the existing `ReplacementSnapshot` + workbench mechanism (built for new-context), so one timed Undo restores draft + angle + lock exactly — which also covers the voice-saving-off case, where the committed text exists nowhere else.
- **Done clears the reply lock; keeps the voice seed and post/thread mode.** The context and angle belonged to the shipped tweet (a stale lock would aim the NEXT post at the old one); the seed and mode are series tools.
- **Auto-reset rejected.** We never see whether the paste landed in X (read-only invariant), so clearing on our own initiative would be presumptuous — and state vanishing by itself cuts against the no-magic ethos. The user says when they're done.
- **Re-copy survives the swap**: singles keep a copy-again button beside Done; thread cards each have their own. ⌃⇧↵ stays copy-only — binding it to Done would make the commit keystroke clear the bench.

### 2026-06-12 — per-example XML tags in the prompt (numbering retired)

Examples were rendered as a numbered list (`1) text`, blank-line separated) inside the block tags. For a TWEET corpus the two boundary cues are both spoofable by content: tweets contain internal blank lines (multi-paragraph posts) and their own list numbering (listicle tweets, "2/" openers) — so examples could bleed together or split apart, silently corrupting exactly the signal they carry (length, density, pacing). Now each item gets its own `<example>` tag (`<thread_example>` per thread, `1/ 2/` segment markers unchanged inside) — the documented Anthropic pattern, an indisputable boundary, ~5 tokens per example. The `N)` numbers are retired entirely: nothing ever referenced an example by number, and removing them kills the spurious-boundary class at the source. A test pins the motivating case (a multi-paragraph self-numbered tweet stays ONE example).

### 2026-06-12 — precedence lines gloss the item tags and rank `<length>`

Thoroughness follow-up to the per-example tags (marginal by agreement): the `<voice_examples>` precedence line now states "each `<example>` inside is one complete post" (thread variant: "each `<thread_example>` is one whole thread, its posts marked 1/ 2/"), and `<length>` gets its own rank in both generation precedences — it was the one block never defined anywhere, even though its enforcement is deterministic downstream regardless.

### 2026-06-12 — feed adjacency is not a reply signal (field-falsified)

Field bug: capturing a standalone post from the profile classified it as a reply; the same tweet captured from its status page classified correctly. Cause: `detectReplyByDomStructure` had a feed branch treating "previous cell holds a tweet" as a parent, built on the assumption that X separates unrelated stream tweets with empty spacer cells — false in the current markup, so EVERY profile tweet below the first read as a reply. The branch also contradicted `classifyType`'s own documented contract (signal 3 was specified as status-page-only). Fix: position-based detection now fires only on `/status/` pages, where vertical order genuinely encodes the conversation; feeds rely on the "Replying to @" marker alone. Known accepted tradeoff: a paired reply rendered without that marker on a feed classifies as 'post' — rarer and milder than the old failure (the Voice tab's per-item type override is the recourse), and capturing replies from the conversation page itself classifies correctly.

### 2026-06-12 — every save outcome lands in the one floating banner (success retires stale errors)

Premise from dogfooding: fix a failed save (e.g. expand the collapsed post the truncation error named) and the eventual success should retire the error banner even mid-countdown. For captures this already held by construction — the floating banner is a single slot and every `bg:save-result` replaces it. The hole was manual add: `handleManualAdd` replied only to the form (its success was entirely silent — a stale VoiceScreen comment promised a banner that never fired), so capture-error → paste-it-instead → success left the error counting down beside a successful save. Manual adds now broadcast the same `bg:save-result` (success or duplicate, with the row flash and the Show-me action riding along); pasted threads read "Added as a thread · N posts" with the exact count — no scroll-into-view caveat, which is capture-specific. Invariant restated on the contract: every save outcome flows through the one banner slot, so a fresh result always supersedes a lingering one.
