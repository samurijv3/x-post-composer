# design.md — what Margin is and why

Product intent and the reasoning behind decisions. For system structure see `architecture.md`; for rules see `CLAUDE.md` and `conventions.md`. This file explains _why_ the code is shaped the way it is, so future changes don't accidentally argue with settled decisions.

## What it is, who it's for

Margin is an in-stream scratch pad for one person who posts on X and wants drafts in their own voice without leaving reading flow. They read X normally; when they want to reply or post, they open the side panel, drop a few bullets, and get a clipboard-ready draft that sounds like them. They bring their own Anthropic API key and pay for their own generations.

It is **a tool for one user's own writing** — not a growth tool, not an engagement bot, not a multi-account manager.

## The honest-wrapper ethos

Margin is deliberately the opposite of a marketplace tool that hides a thin prompt behind a slick UI:

- **Every prompt is visible and editable** (options → Prompts). The Compose screen's "Inspect last prompt" shows the exact System/User text sent and the raw response.
- **The UI never overstates what's happening.** If a mechanism doesn't apply in practice (e.g. prompt caching below the per-model minimum), the copy says so. Honest claims beat impressive ones.
- **The repo is the product's trust story.** Public, MIT, small enough to read end-to-end, with `SECURITY-AUDIT.md` as the standing, re-runnable verification. We do not fake at-rest key encryption, because on a public repo it would be reversible theater; instead the README tells users to set a spend cap.

When a design choice trades polish against transparency, transparency wins.

## Core flows (intent level)

**Capture a tweet to the voice library.** Voice screen → "Save tweets from X" → click your own tweets. The author **hard filter** (handle must match settings) exists because the library defines the user's voice — one stray retweet pollutes every future draft. Manual paste exists as the fallback and uses an explicit "this is my own writing" confirmation instead of the filter.

**Pull in reply context.** Compose → "Reply to a tweet" mode → click the target tweet on x.com. The selection is shown twice — a highlight overlay on the page and a card in the panel — so the user always knows exactly what the model will see. Mode stays on after a pick so a second click swaps the target. There is no explicit post/reply switch: **mode is derived from whether a reply context is attached**, because that's the only fact that matters.

**Generate.** Bullets are interpreted, never pasted verbatim into the draft. The pipeline samples up to `poolSize` examples of the matching type (posts for posts, replies for replies), fills the editable template, calls Anthropic once, then applies the deterministic backstops (below). Regenerate reshuffles the example pool and runs hotter (`temperature.regenerate`) — its job is a _different_ draft, not a retry.

**Refine.** Chips and more/less reshape the **current draft only** — they never resample, so the user can converge without losing what they liked. Pressing the same chip again escalates the instruction wording (press 2 "push harder", press 3 "dramatically", 4+ "maximum intensity"), because models otherwise return near-identical output for repeated identical asks. One level of Undo.

**AI-ism control, prevention first.** The prompt itself instructs the model what to avoid (em dashes, smart quotes, staccato runs, the do-not-say banlist), so most drafts come back clean. What slips through is handled deterministically: mechanical auto-fix for the safely-fixable (em dash → comma, curly → straight), then **at most one** repair re-prompt for the rest, then **at most one** tighten re-prompt if the ≤280 cap is on and the draft still measures over. Residue that survives is highlighted for hand-editing, never silently looped on. The hard ceiling is **three API calls per generation** — cost-bounded by construction.

**Counting.** X's official weighted counting (`twitter-text`) for the 280 gate, because `.length` disagrees with what X shows the user. The uncapped "soft cap" is a prompt instruction only — deliberately no deterministic gate, since it's our own guideline, not X's rule.

**Settings.** The panel is for composing; everything configurable lives in the full-page options (Account, Output rules, Prompts, Data). The API key field is **write-only**: the UI knows whether a key is set, never the value — replacing means pasting a new one, removing is an explicit Clear. Output rules and prompt edits apply on blur; the key uses an explicit Save because it's a secret.

**Ephemerality by storage choice.** Things that are per-session by nature live in `chrome.storage.session` and evaporate on full quit: the reply-context lock, the capture mode, the last prompt/response, the optional session-only key. The library and settings persist in IndexedDB / `storage.local`. Nothing syncs anywhere.

## Non-goals (hard, by design — not missing features)

- **No auto-posting.** Output goes to the clipboard; the user finishes by hand in X's composer. This keeps the human in the loop and keeps Margin out of the business of acting on X's UI.
- **No telemetry, analytics, or middleman server.** The only outbound request is the user's own generation to `api.anthropic.com` (plus inbound avatar images from `pbs.twimg.com`). There is nothing to phone home to.
- **No read-at-scale.** The extension reads exactly the tweets the user clicks (capture / reply-context) plus the composer's context for the shortcut. It is not a scraper and must never become one — no timeline harvesting, no background collection.
- **No multi-account, no team features.** One handle, one voice, one key.
- **No fake security.** No baked-in encryption of the key (reversible on a public repo); honest posture + spend-cap guidance instead.

A feature request that violates one of these is declined, not deferred.

## Deferred features and their rationale

These are wanted-but-later, with the code seams already in place (`CLAUDE.md` §8 lists the seams; don't collapse them):

| Deferred                     | Why deferred                                                                                              | The seam waiting for it                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bulk archive import          | v1 proves the voice loop with hand-picked examples first; import needs screening UX                       | `src/lib/screening/` (tested, dormant), `EXPORT_SCHEMA_VERSION` on exports                                                                            |
| Thread mode                  | Single-post drafting had to feel right first                                                              | `Draft = { posts: PostDraft[] }` — always length 1 today; never assume a draft is one string                                                          |
| Semantic retrieval           | Shuffled manual picks are good enough until the library is large                                          | `selectExamples(mode, context, library, opts)` is the single swap point; `LibraryItem.embedding` (null) and the `byType` index reserved in the schema |
| Model picker                 | One verified-current default beats an untested dropdown                                                   | `settings.model` (shown read-only in Account); picker must gate `temperature` by model family — Opus 4.7+ reject sampling params                      |
| Image / quote-tweet reads    | Text-only capture keeps v1's privacy story simple                                                         | `hadUnreadableMedia` flag surfaces the limitation to the user                                                                                         |
| Auto-expand truncated tweets | X gates "Show more" behind `event.isTrusted`; the only workaround (`chrome.debugger`) is disproportionate | Truncation is detected and the user is asked to expand                                                                                                |

## Voice & copy

UI copy is plain, direct, lowercase-comfortable, and honest about limitations ("v1 captures text only"). Errors say what happened and what to do next; no error is silently swallowed (the single sanctioned exception: a capture-mode click that wasn't on a tweet does nothing, because nothing is what happened).
