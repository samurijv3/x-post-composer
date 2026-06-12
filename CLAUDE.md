# CLAUDE.md

Operating guide for this repository. Read this before doing any work, in every session. These rules override convenience and default behavior. When a rule here conflicts with something you'd otherwise do, this file wins.

---

## 1. What this project is

A **Chrome extension** that acts as an in-stream "scratch pad" for composing posts and replies on X.com, in the user's own voice. The user brings their own Anthropic API key. The extension reads the tweet being replied to, samples the user's saved writing for voice, and drafts a reply or post that the user copies into X and finishes by hand.

**Ethos: this is an honest LLM wrapper, and the UI should make that obvious.** No hidden prompts, no black boxes, no magic. Prompts are visible and editable; the user can always inspect the exact text sent to the model. We are deliberately the opposite of a marketplace tool that hides a thin prompt behind a slick UI. Favor transparency and user control over the appearance of sophistication.

The repo is **public and MIT-licensed**. Write every line as if a stranger will read it, fork it, and trust it with their API key.

---

## 2. Stack

- **WXT** (wxt.dev) for the extension framework — handles MV3 manifest, the side panel, content scripts, background service worker, and HMR.
- **React + TypeScript** for UI.
- **Vitest** for tests (happy-dom + fake-indexeddb; see `testing.md`).
- **ESLint + Prettier** — typescript-eslint **type-checked tier** for lint/format.

> Before scaffolding or using any WXT-specific API, **consult the current WXT docs** (wxt.dev). Do not rely on memorized API shapes — WXT's entrypoint and config conventions change. Likewise, **verify current Anthropic model IDs** from docs.claude.com rather than hardcoding a string from memory.

---

## 3. Architecture principles

The single biggest failure mode to avoid is **one giant file**. The second is **speculative abstraction**. Both are forbidden.

- **Prefer the simplest thing that works.** Abstract on the third repetition, not the first. No layers, interfaces, or indirection added "for the future" unless this file explicitly calls for a seam (see §8).
- **Separate the brain from the shell.** All consequential logic — exclusion checks, prompt assembly, example sampling, character counting, author validation, classification, screening — lives as **pure, framework-free functions** with no React, no DOM, no `chrome.*`, no `fetch`. The shell (React UI, storage, the network call) composes those functions. Pure logic must be importable and testable in isolation.
- **One module, one responsibility.** If a file exceeds ~200 lines or does two clearly separable jobs, split it. UI components stay small and composed.
- **Frontend, background/network, and storage are distinct layers** with explicit boundaries. They communicate through typed contracts, not by reaching into each other's internals.

### Actual shape (WXT directory entrypoints; full map in `architecture.md`)

```
entrypoints/
  background/       index (routing) · generation (pipeline + key) · capture · tabs
  twitter.content/  index (wiring) · extract (X-DOM reads, fixture-tested) · overlay (§6 carve-out)
  sidepanel/        React root + the panel-liveness heartbeat port
  options/          React root
src/
  lib/              pure, framework-free, fully tested logic
    exclusion/        structural detectors, mechanical auto-fix, do-not-say matcher
    prompt/           template engine + DEFAULT_PROMPT_TEMPLATES (single source) + assembly
    sampling/         selectExamples (the §8 retrieval seam)
    counting/         twitter-text wrapper
    screening/        quality predicates — DORMANT until Phase-2 import, tested anyway
    voice/            author validation, post-vs-reply classification
    format/           x.com-style relative timestamps
  api/              Anthropic client. Imported ONLY by entrypoints/background/generation.ts.
  storage/          config + key (write-only from UI) + corpus (IndexedDB, versioned) + session state
  messaging/        typed message contracts + envelope (panel <-> background <-> content)
  ui/               React components (compose/, voice/, sections/)
  types/            shared TS types (LibraryItem, Draft, Settings, ...)
```

The one sanctioned brain-outside-lib: `entrypoints/twitter.content/extract.ts` (DOM-reading by necessity, tested like lib — see `architecture.md`).

---

## 4. Code style

- **Strict TypeScript.** `strict: true`. No `any` at module boundaries; if a third-party type forces it, isolate and comment it. Prefer precise types and discriminated unions over loose objects.
- **Comment the _why_, not the _what_.** Code should read clearly enough that line-by-line narration is noise. Reserve comments for intent, non-obvious tradeoffs, and the reason a thing exists. Put a short JSDoc on every exported function describing purpose, inputs, and outputs.
- **Names say what things are.** No `data`, `tmp`, `handle2`. Functions are verbs, values are nouns.
- **Errors are handled, never swallowed.** Surface failures to the user with a clear message; never leave an empty `catch`.
- **Conventional Commits** for messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

---

## 5. Testing

"Comprehensive" here means **every load-bearing piece of deterministic logic has a test** — not a line-coverage percentage. Do not write filler tests that assert nothing to hit a number; that is its own kind of snake oil.

**Must be tested** (these are the brain): exclusion detectors (staccato, em dash, smart quotes), the do-not-say whole-word matcher, the character-counting wrapper, prompt assembly + slot validation + the template-consistency invariants, `selectExamples` sampling, screening predicates, author validation, post-vs-reply classification, the settings merge/migration, the Anthropic client's request shape + error mapping (stubbed fetch), the IndexedDB CRUD + every schema migration, and the X-markup extraction layer (DOM fixtures).

**Need not be tested:** React glue, styling, thin `chrome.*` wrappers, and entrypoint wiring — `testing.md` lists these explicitly; don't filler-test them.

Tests live next to the code they cover (`*.test.ts`). `npm run verify` (lint + format + types + tests + build) green before every commit.

---

## 6. Security invariants — HARD RULES

These are not advisory. Never violate them, under any circumstance, even temporarily during development.

- **The API key VALUE is readable only by the background service worker.** `getApiKey` has exactly one calling file: `entrypoints/background/generation.ts`. The settings UI is **write-only** — it submits a new key (`setApiKey`), checks presence (`hasApiKey`), clears (`clearApiKey`), and never reads the stored value back into page state or the DOM. The key is **never injected into the X.com page, never sent to a content script, never placed in any message payload, never echoed in errors.** The `src/api/` Anthropic client is imported **only** by the background's generation module — never by content or panel code.
- **Never log the key.** Not to console, not to any file, not in error messages. Not even truncated.
- **No telemetry. No phoning home. No analytics. No remote endpoints of any kind**, except:
  - The Anthropic Messages API at `api.anthropic.com` (the user's own generation).
  - Inbound image fetches from `pbs.twimg.com` (X's public avatar CDN), used **only** as `<img src="…">` for avatars rendered in the reply-context card and library rows. This is a one-way, body-less GET that the browser makes when the panel paints. **No user data, no API key, no tweet content, and no identifying headers beyond the default `Accept`/`User-Agent` ever leave the extension on this path.** Avatar URLs are public; the user is already loading the same images on x.com. This carve-out is image-only — `pbs.twimg.com` is not used for analytics, tracking pixels, fingerprinting, or any non-avatar resource. The README must state this plainly.
- **Storage is `chrome.storage.local`, never `chrome.storage.sync`.** `.sync` would push secrets and personal data to Google's servers and other devices. Forbidden.
- **The extension never modifies X's existing DOM and never auto-posts.** Output goes to the clipboard only. The only contact with X's existing tree is _read-only_ (reading the tweet being replied to, and capturing the user's own tweets), and it must degrade gracefully when X's markup changes.
- **Narrow carve-out: extension-owned overlays.** The extension MAY append a small number of its own elements to the document for purely informational UI (e.g. a highlight overlay marking which tweet is currently selected as reply context, and a hover-preview indicator while a capture mode is active). These overlays must:
  - **Be visually attributable to the extension**, never spoof X's UI or content.
  - **Carry a dedicated `data-margin-overlay` attribute** so a contributor or auditor can identify everything we render with one `grep`.
  - **Use `pointer-events: none` on all visuals.** The user must still be able to interact with the underlying X content through the overlay.
  - **Permit at most one interactive child: a dismiss control** that may _only_ clear extension-side state (the captured reply-context lock). It may not trigger any action on X (no posting, no navigation, no DOM mutation of X's tree).
  - **Never persist data into X's DOM** in a way X could read back. Attributes we set on our own elements only; we do not annotate X's elements.
  - **Disappear on**: capture-mode-off, reply-context cleared, dismiss clicked, SPA navigation, tab teardown. _Clarified 2026-06-11:_ on SPA navigation the highlight vanishes with the old view and may **re-attach only to the locked tweet itself** where the new view renders it — re-derivation from live state, not lingering. It must never persist where the locked tweet is not rendered.
    Anything beyond this carve-out — hover tooltips with rich content, drag handles, action buttons embedded near X's UI, persistent badges on X's elements, layout-altering wrappers — remains forbidden under the read-only invariant.
- **Tight permissions.** Host access limited to X.com (and twitter.com). No `<all_urls>`. Only the permissions actually needed (`storage`, `sidePanel`, clipboard write, `unlimitedStorage`).

We do **not** fake at-rest encryption. On a public repo any baked-in key is reversible, so pretending to encrypt would be dishonest. The honest posture (stated plainly in the README and near the key field): the key is stored unencrypted in local extension storage, protected by the OS account and the extension sandbox; the blast radius of a leak is bounded to API spend and is fully revocable; **users should set a spend cap on their key.**

---

## 7. Data & privacy invariants

- All user data — the API key, settings, and the writing corpus — stays on the user's machine.
- The corpus (potentially thousands of items) lives in **IndexedDB**, versioned from day one so schema migrations stay clean. Small config and the key live in `chrome.storage.local`.
- Be transparent that tweet content and drafts **are** sent to Anthropic as prompt content — that is inherent to using the API. The privacy claim is "no middleman server," not "nothing leaves your device." Say so in the README.
- Provide an **export-library-as-JSON** path so the user always has a portable backup independent of the browser.

---

## 8. Deferred-feature seams — DO NOT collapse these

v1 omits three features, but the code must be shaped now so they bolt on without a refactor. Preserve these even though v1 doesn't exercise them:

- **A draft is an array of posts** (`Draft = { posts: PostDraft[] }`) — _seam exercised 2026-06-12:_ thread mode (roadmap Phase 10) produces real multi-post drafts; singles are the length-1 case. Never assume a draft is a single string.
- **`LibraryItem` carries a nullable `embedding` field**, unpopulated in v1. This reserves room for semantic retrieval later. The IndexedDB schema must include it.
- **Example selection sits behind one function: `selectExamples(mode, context, library) => examples[]`.** v1's implementation shuffles manual picks; retrieval becomes an alternate strategy behind the same signature later. Never inline sampling logic into the prompt builder.
- **The IndexedDB layer is versioned** with a migration path, so adding fields later is clean.

---

## 9. Companion docs — read before working

This file is the constitution; the companion docs are ground truth, kept current as part of "done". Six describe the repo **as it actually exists** (derived from the code); `roadmap.md` is the one forward-looking doc — canonical for where the product is going, same update discipline.

| Doc               | What it holds                                                                      | Read it when…                                                                      |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `design.md`       | As-built product intent, decision rationale, hard non-goals                        | judging whether a change fits the product                                          |
| `roadmap.md`      | Forward-looking phases, the not-building list, the append-only Build Decisions Log | planning or building any feature work, and when settling a judgment call mid-build |
| `architecture.md` | Surfaces, brain/shell, data flow, messaging, storage, security boundary, MV3 facts | changing structure, messages, storage, or anything §6-adjacent                     |
| `components.md`   | Registry of every module: contract + where it's tested                             | **before touching or adding any code**                                             |
| `slices.md`       | Each feature traced end to end                                                     | working on a flow, or slotting in a feature                                        |
| `testing.md`      | What's tested and why, the patterns, how to add tests                              | writing or judging tests                                                           |
| `conventions.md`  | Enforceable code/git/doc rules + the doc-update matrix                             | always — it defines "done"                                                         |

Session start: this file → `conventions.md` → (feature work) the phase in `roadmap.md` incl. its Build Decisions Log → the slice(s) you'll touch in `slices.md` → the modules' rows in `components.md`. Don't re-derive what the docs already state; don't trust memory over them.

## 10. Working agreement

- Read this file (and the table above) at the start of every session.
- When current API details matter (WXT, Anthropic models, MV3 behavior), look them up rather than guessing; `architecture.md` records the MV3 facts the code already depends on.
- **Done means:** `npm run verify` green, commits per `conventions.md`, and the companion docs updated for whatever changed (matrix in `conventions.md`). A change that leaves a doc lying isn't done.
- At the end of a work chunk, leave the tree green and write a short note of what was built and how to verify it.
- Keep this file authoritative. If a decision here turns out wrong, update this file rather than silently diverging — and update the companion doc that elaborates it.
