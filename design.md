# design.md — what Margin is and why

Product intent and the reasoning behind decisions **as built**. Forward-looking intent — where the product is going, in what order, and why — lives in `roadmap.md` (including its append-only Build Decisions Log); this file explains _why the code that exists is shaped the way it is_, so future changes don't accidentally argue with settled decisions. For system structure see `architecture.md`; for rules see `CLAUDE.md` and `conventions.md`. The two files must not duplicate: when a roadmap phase ships, its rationale graduates from `roadmap.md` into here.

## What it is, who it's for

Margin is an in-stream scratch pad for one person who posts on X and wants drafts in their own voice without leaving reading flow. They read X normally; when they want to reply or post, they open the side panel, drop a few bullets, and get a clipboard-ready draft that sounds like them. They bring their own Anthropic API key and pay for their own generations.

It is **a tool for one user's own writing** — not a growth tool, not an engagement bot, not a multi-account manager.

## The honest-wrapper ethos

Margin is deliberately the opposite of a marketplace tool that hides a thin prompt behind a slick UI:

- **Every prompt is visible and editable** (options → Prompts). The Compose screen's "Inspect last prompt" shows every call in the last invocation — the exact System and User text of each, labelled by purpose (generate / refine / repair / tighten) — plus the raw response.
- **The UI never overstates what's happening.** If a mechanism doesn't apply in practice (e.g. prompt caching below the per-model minimum), the copy says so. Honest claims beat impressive ones.
- **The repo is the product's trust story.** Public, MIT, small enough to read end-to-end, with `SECURITY-AUDIT.md` as the standing, re-runnable verification. We do not fake at-rest key encryption, because on a public repo it would be reversible theater; instead the README tells users to set a spend cap.

When a design choice trades polish against transparency, transparency wins.

## Core flows (intent level)

**Capture a tweet to the voice library.** Voice screen → "Save tweets from X" → click your own tweets. The author **hard filter** (handle must match settings) exists because the library defines the user's voice — one stray retweet pollutes every future draft. Manual paste exists as the fallback and uses an explicit "this is my own writing" confirmation instead of the filter.

**Pull in reply context.** Compose → "Reply to a tweet" mode → click the target tweet on x.com. The selection is shown twice — a highlight overlay on the page and a card in the panel — so the user always knows exactly what the model will see. Mode stays on after a pick so a second click swaps the target. Re-selecting the **same** tweet through a different rendering (X's modal copies carry no author or status links) enriches the existing selection rather than degrading it — identity by status id, else by normalized text, the same dedupe rule the corpus uses. There is no explicit post/reply switch: **mode is derived from whether a reply context is attached**, because that's the only fact that matters.

**On-page overlays yield to X.** The highlight is a guest on someone else's page, so it defers to X's own UI state: while X has a modal open (reply dialog, composer, lightbox — anything `aria-modal`) overlays paint only on the modal's own content — the locked tweet's highlight follows it into a modal that re-renders it (identity by status id, else by text, since X strips the links off modal copies), you can hover-preview and select there, but nothing of ours ever floats over the scrim or the inert timeline beneath it. Modal aside, the highlight shows only while the tab is on the page where the lock was affirmed — navigate away and it hides, come back (or re-affirm with a new selection / mode re-toggle) and it returns. The away/back rule is derived from the current path rather than a "navigation happened" flag because X's modals are URL-addressable (Reply pushes `/compose/post` and pops back on close) — a sticky flag killed the highlight permanently after any modal round-trip. The _lock_ survives all of it — the panel card is the persistent indicator; the page highlight is just its shadow. The signals are standards-level and fail open: if X's markup drifts, the overlay degrades to its old behavior rather than breaking. We hide under modals instead of z-index-dueling with X's stacking because guessing another site's internals is exactly the coupling the read-only posture forbids.

**The panel knows when you've left X.** Capture and reply-context only work against an x.com tab, so when the active tab is elsewhere the panel says so with a translucent veil ("Open x.com" / "Compose anyway") instead of letting capture gestures silently do nothing. Deliberately built without the "tabs" permission: Chrome hides non-X URLs from us, and "we can't see it" reads as "not on X" — the extension never learns where else the user browses.

**Generate.** Bullets are interpreted, never pasted verbatim into the draft. The pipeline samples up to `poolSize` examples of the matching type (posts for posts, replies for replies), fills the editable template, calls Anthropic once, then applies the deterministic backstops (below). Regenerate reshuffles the example pool and runs hotter (`temperature.regenerate`) — its job is a _different_ draft, not a retry.

**Refine.** Chips and more/less reshape the **current draft only** — they never resample, so the user can converge without losing what they liked. Pressing the same chip again escalates the instruction wording (press 2 "push harder", press 3 "dramatically", 4+ "maximum intensity"), because models otherwise return near-identical output for repeated identical asks. One level of Undo.

**AI-ism control, prevention first.** The prompt itself instructs the model what to avoid (em dashes, smart quotes, staccato runs, the do-not-say banlist), so most drafts come back clean. What slips through is handled deterministically: mechanical auto-fix for the safely-fixable (em dash → comma, curly → straight), then **at most one** repair re-prompt for the rest, then **at most one** tighten re-prompt if the ≤280 cap is on and the draft still measures over. Residue that survives is highlighted for hand-editing, never silently looped on. The hard ceiling is **three API calls per generation** — cost-bounded by construction.

**Counting.** X's official weighted counting (`twitter-text`) for the 280 gate, because `.length` disagrees with what X shows the user. The uncapped "soft cap" is a prompt instruction only — deliberately no deterministic gate, since it's our own guideline, not X's rule.

## Prompt architecture (as built)

_Shipped 2026-06-11 as roadmap Phase 1 ("prompt-assembly-v2"); the build-time judgment calls are dated entries in `roadmap.md` → Build Decisions Log._

Everything is text to the model at send time — what makes a model _use_ context well is structure, labeling, and explicit priority, not delivery mechanism. The shape that follows from that:

- **Two-body templates, real message roles.** Every template is an explicit `{system, user}` pair mapping one-to-one onto the API's roles. The boundary is decided by one test: _does this block change between two consecutive calls?_ Invariant (role definition, the output-ONLY rule, the precedence preamble, style guide, exclusions) → system. Varying (example blocks, reply context, length constraint, intent / draft + instruction) → user. A clean boundary also keeps the system block **cacheable later** — deliberately not implemented now (below the per-model minimum it would be theater; see the honesty note in `src/api/anthropic.ts`), but per-call content leaking into system would forfeit the option.
- **XML-style tags delimit every block** (`<style_guide>`, `<exclusions>`, `<voice_examples>`, …). Models respect explicit open/close boundaries far more reliably than ALL-CAPS headers, and the benefit scales as prompts grow.
- **A precedence preamble, fixed in code, ranks the blocks**: exclusions are hard constraints → style guide is authoritative → aspirational examples are the bar → voice examples are range → reply context is _to react to, never imitate_ → intent is what to develop. It's code-supplied (filled into a `{{precedence}}` slot) rather than editable prose because the pipeline relies on the authority order — but it stays fully visible in the inspector, and removing the slot from a template is still the user's right.
- **Two example blocks, not three.** `<aspirational_examples>` ("the user at their best — the bar") and `<voice_examples>` ("match tone and rhythm, never topics"). Curated-vs-archive origin is a sampling-weight decision, not a labeling one — the model never learns a sampled example's source. The aspirational block ships present-but-empty (it collapses); the Star tier (roadmap Phase 5) populates it.
- **Every refinement carries a voice anchor.** Chips, more/less, exclusion repair, and tighten all render through one `refine` template whose system body carries the same role + precedence + style guide + exclusions as generation — only `{{instruction}}` differs (panel-supplied for chips/steering, code-supplied for repair/tighten). This fixed the v1 quality leak where refine passes carried only draft + instruction and drifted toward generic with each press; carrying exclusions also stops refinements reintroducing banned patterns.
- **Intent framing varies by input shape.** A small heuristic (`classifyIntentShape`) reads the bullets: scattered fragments get _"find the throughline and weave them"_; flowing prose gets _"a direction to develop and tighten."_ One template, one variable framing line — deliberately not two sub-templates, and deliberately a crude heuristic: a wrong guess costs one sentence.
- **The honest migration:** v1's single-body templates had no faithful mapping onto the new shape, so customised v1 bodies **reset** to the new defaults rather than being preserved-but-broken. Worse for the user's edits, better than silently sending malformed prompts.

**Settings.** The panel is for composing; everything configurable lives in the full-page options (Account, Output rules, Prompts, Data). The API key field is **write-only**: the UI knows whether a key is set, never the value — replacing means pasting a new one, removing is an explicit Clear. Output rules and prompt edits apply on blur; the key uses an explicit Save because it's a secret.

**Ephemerality by storage choice.** Things that are per-session by nature live in `chrome.storage.session` and evaporate on full quit: the reply-context lock, the capture mode, the last prompt/response, the optional session-only key. The library and settings persist in IndexedDB / `storage.local`. Nothing syncs anywhere.

## Non-goals (hard, by design — not missing features)

- **No auto-posting.** Output goes to the clipboard; the user finishes by hand in X's composer. This keeps the human in the loop and keeps Margin out of the business of acting on X's UI.
- **No telemetry, analytics, or middleman server.** The only outbound request is the user's own generation to `api.anthropic.com` (plus inbound avatar images from `pbs.twimg.com`). There is nothing to phone home to.
- **No read-at-scale.** The extension reads exactly the tweets the user clicks (capture / reply-context) plus the composer's context for the shortcut. It is not a scraper and must never become one — no timeline harvesting, no background collection.
- **No multi-account, no team features.** One handle, one voice, one key.
- **No fake security.** No baked-in encryption of the key (reversible on a public repo); honest posture + spend-cap guidance instead.

A feature request that violates one of these is declined, not deferred. The complementary _strategic_ rejections — future directions considered and ruled out (multi-platform, a managed paid tier, agentic reply queues, automatic behavioral learning) — are recorded with their reasoning in `roadmap.md` → "What We're Deliberately Not Building", and carry the same force.

## Deferred features

What's deferred, why, and in what order is owned by **`roadmap.md`** — the phased plan, sequencing rationale, and the append-only Build Decisions Log live there; nothing in this file should restate it. The as-built side of that plan is the set of seams already in the code: the four `CLAUDE.md` §8 seams plus the documented dormant pieces (listed in `conventions.md` rule 2, with contracts in `components.md`). Don't collapse a seam because its phase hasn't started.

## Voice & copy

UI copy is plain, direct, lowercase-comfortable, and honest about limitations ("v1 captures text only"). Errors say what happened and what to do next; no error is silently swallowed (the single sanctioned exception: a capture-mode click that wasn't on a tweet does nothing, because nothing is what happened).
