# Margin

_In the margin of X._

A Chrome extension scratch pad for composing X.com posts and replies in your own voice. You bring your own Anthropic API key. The extension reads the tweet being replied to, samples your saved writing for voice, and drafts something that sounds like you — which you copy into X and finish by hand.

It is an **honest LLM wrapper for a specific job**: visible prompts, editable templates, exclusion rules you control, deterministic counting, and clipboard-only output. The whole thing is ~7,000 lines of TypeScript and is meant to be read end-to-end.

This repo is public, MIT-licensed, and ships no telemetry of any kind.

---

## What it does

- **Capture** your own tweets from x.com with a click-to-add mode that hard-filters on your handle.
- **Generate** post and reply drafts in your voice using sampled examples from your captured library + a style guide + your bullets.
- **Refine** the on-screen draft via chips (Shorter / Warmer / Punchier — all editable) or debounced "more / less" steering fields.
- **Regenerate** to reshuffle examples and bump temperature when a draft doesn't land.
- **Enforce** deterministic output rules: em dashes auto-fix to commas, smart quotes auto-fix to straight, staccato runs and a do-not-say banlist trigger one repair re-prompt and highlight residue.
- **Count** characters with X's official `twitter-text` weighting (URLs always weigh 23, some characters weigh 2). Over-280 drafts get one automatic Tighten pass.
- **Copy** the result to clipboard. The extension never writes to X's DOM and never auto-posts.

---

## Security & privacy — read this before installing

**You are trusting this extension with an API key. We want to be honest about what that means.**

- The key is stored **unencrypted** in `chrome.storage.local` (or `chrome.storage.session` if you choose). It is protected only by your OS account and Chrome's extension sandbox. We deliberately **do not** fake at-rest encryption — a public repo's "encryption" would be reversible by anyone reading the code, and pretending otherwise would be dishonest.
- The blast radius of a key leak is bounded to **API spend** and is fully **revocable** in seconds at the Anthropic console.
- **Set a spend cap on your Anthropic key before using this extension.** This is the single most important thing you can do.
- The key is read **only by the background service worker**, never injected into the X.com page, never held in any UI state beyond the settings input field while the user types it, and **never logged**.

**What actually leaves your machine:**

- The tweet you're replying to + your bullets + sampled examples go to **`api.anthropic.com`** as prompt content. That is inherent to using their API.
- **Nothing else.** No telemetry, no analytics, no proxy server, no third-party hosts. The single `fetch()` in the codebase is in `src/api/anthropic.ts` and it targets exactly one URL.
- Your captured library lives in **IndexedDB** at the extension's own origin. The X page cannot read it. Nothing reads it except the background worker assembling a prompt.
- Settings are in `chrome.storage.local`. **Never `chrome.storage.sync`** — that would push data to Google's servers.

**What the extension cannot do** (enforced by manifest + code):

- Reach any host besides `api.anthropic.com`, `x.com`, and `twitter.com`. No `<all_urls>` permission.
- Write to X's DOM or auto-post. The Copy button is the only output path.
- See your X content from anything but a user-initiated capture click on a tweet authored by your configured handle.

You can verify all of the above in 30 seconds: open the background service worker's DevTools (`chrome://extensions` → "service worker" link) and watch the Network tab while generating. Exactly one outbound request to `api.anthropic.com/v1/messages`. No other hosts. Ever.

The full architectural contract is in [`CLAUDE.md`](./CLAUDE.md) — particularly §6 (security invariants) and §7 (data & privacy).

---

## Install (developer / unpacked)

The extension is not in the Chrome Web Store. Load it unpacked from your own build.

```bash
git clone <this-repo>
cd x-post-composer
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `.output/chrome-mv3` folder from this repo. (On macOS, press ⌘-Shift-. in the file picker to reveal dotfolders.)
5. Pin the extension to the toolbar.

Then in the side panel's **Account** tab:

1. Enter your X handle (the hard filter for what enters your library).
2. Paste your Anthropic API key. **Set a spend cap first.**
3. Pick where the key lives:
   - **Persistent** (`chrome.storage.local`) — survives browser quits.
   - **Session only** (`chrome.storage.session`) — cleared when you fully quit Chrome. Stronger isolation; key has to be re-entered each session.
4. Click **Verify key** to confirm it works with Anthropic.

---

## Usage

### Capture your voice

1. On x.com, open the side panel and turn on **Capture mode**.
2. Click your own tweets in the timeline. The extension intercepts the click (no navigation), validates the author against your handle, and saves the tweet to your local library.
3. Manage entries in the **Voice** tab: edit text inline, override post/reply, delete.
4. You can also paste text into the **Add manually** form, ticking "I confirm this is my own writing."

### Compose

1. With the panel open on x.com, pick **Post** or **Reply** mode.
2. **Reply mode**: click X's native Reply on the target tweet, then click **Capture reply context**. Or use the keyboard shortcut **Alt-Shift-R** to open the panel + capture in one step.
3. Type bullets describing what you want to say.
4. Toggle **≤280 chars** on/off (the soft cap for uncapped mode is in Output rules).
5. **Generate**.

### Refine

The draft appears with an X-weighted character counter. Reshape it without reshuffling:

- **Chips** (Shorter / Warmer / Punchier — editable in Prompts tab): one click rewrites the current draft per the chip's stored instruction.
- **More / less** steering fields: type a phrase (140 char cap each); ~1s after you stop typing, the draft auto-refines. Contents persist across chip clicks and refines.
- **Regenerate**: fresh samples + higher temperature. Clears more/less. Use when a draft "didn't land" and you want a different angle.
- **Undo**: one level back.

### Copy out

Click **Copy** on the draft. Paste into X's open compose box. Finish by hand.

---

## Architecture (overview)

```
entrypoints/
  background.ts          The sole place the key is read and Anthropic is called.
                         Orchestrates: sample → assemble → call → autoFix →
                         exclusion repair → tighten repair → return.
  twitter.content.ts     Read-only DOM scanning on x.com. Capture clicks +
                         reply-context extraction. Never writes the page.
  sidepanel/, options/   React entries.

src/
  lib/                   Pure, framework-free, fully tested.
    counting/            twitter-text weightedLength wrapper.
    exclusion/           Structural + do-not-say detectors, auto-fix, check.
    prompt/              Template assembly + slot validation + defaults.
    sampling/            selectExamples (the CLAUDE.md §8 retrieval seam).
    screening/           isEmojiOnly, isSingleWord, isBelowMinChars.
    voice/               validateAuthor (hard filter), classifyType.
  api/anthropic.ts       The fetch wrapper. ONLY imported by background.
  storage/               chrome.storage.* (local/session) + IndexedDB corpus.
  messaging/             Typed contracts + envelope (request/reply +
                         broadcast notice).
  types/                 LibraryItem, Draft = { posts[] }, Settings, etc.
  ui/                    React components — sidepanel + options share these.
```

**Boundaries** (verified by `grep`, see commit history):

- `src/api/` imports: 1 file, `entrypoints/background.ts`.
- `getApiKey` / `setApiKey` callers: `AccountTab.tsx` (settings input) + `background.ts` only.
- `fetch()` calls: 1, in `src/api/anthropic.ts`, to `https://api.anthropic.com/v1/messages`.
- Content script imports: zero from `api/` or `storage/key`.

**Stack**: WXT + React + TypeScript (strict), Vitest, ESLint + Prettier, `twitter-text`, `fake-indexeddb` (test only). No Anthropic SDK — a 20-line `fetch` wrapper is more honest for a public repo.

### Tests

121 tests across 12 files cover every load-bearing pure module: exclusion detectors (em-dash, smart quotes, staccato boundary 2-vs-3 + word-count edges), do-not-say whole-word matcher (incl. "art" ≠ "start", "fine art" ≠ "modern art", multi-word, case-insensitive), mechanical auto-fix, twitter-text weighted counting (plain / URL / weight-2 emoji), prompt assembly + slot drift detection, `selectExamples` (filter / cap / shuffle-varies), screening predicates, `validateAuthor`, `classifyType`, and the IndexedDB corpus CRUD (under fake-indexeddb).

Per CLAUDE.md §5 there is no coverage-percentage gate. Behavior that matters is tested; UI glue and chrome.\* wrappers aren't filler-tested.

```bash
npm run test       # vitest run
npm run lint       # eslint, clean
npm run compile    # tsc --noEmit, clean
npm run build      # production build → .output/chrome-mv3/
```

---

## Roadmap (deferred from v1)

These are intentional v1 omissions. The code shape preserves the seams so they bolt on without a refactor:

- **Bulk archive import**: drag-and-drop an X data export (`.zip` / `tweets.js`) → screening predicates (already tested) filter the firehose → manual/corpus balance slider (already in Settings, currently disabled) re-weights sampling.
- **Thread mode**: the `Draft = { posts: PostDraft[] }` shape already iterates. DraftDisplay renders posts as a list; the orchestrator currently produces length 1.
- **Semantic retrieval**: `selectExamples(mode, context, library) => examples[]` is the one function to replace. `LibraryItem.embedding` is `null` in v1 but the IndexedDB schema reserves the column.
- **Image / quote-tweet understanding**: reply context capture is text-only; a future version could read images via the Anthropic Vision API.
- **Localised reply detection**: the structural reply heuristic works for English X (and most languages via DOM structure), but a parent-tweet text-match for localised "Replying to" strings would harden it.
- **Auto-expand truncated tweets on capture**: X gates the "Show more" expansion behind `event.isTrusted === true`, which only real user input produces. The only way to dispatch a trusted event from an extension is `chrome.debugger.attach()`, which requires the `debugger` permission — disproportionate for this extension's threat model. Today we detect truncation and ask the user to click Show more themselves; if a less-invasive approach becomes available we'll wire it in.

---

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) first. It is the authoritative operating guide and overrides convenience.

Hard rules a PR must respect:

- The API key never leaves the background worker. `src/api/` is only imported by `entrypoints/background.ts`.
- Storage is `chrome.storage.local` / `.session` and IndexedDB — never `chrome.storage.sync`.
- Content scripts are read-only. No DOM writes, no auto-post.
- Host permissions are limited to x.com / twitter.com. The single external host the extension may reach is `api.anthropic.com`.
- Pure logic in `src/lib/` ships with tests. UI glue does not need tests for the sake of percentages.
- Prompts and instructions are **visible and editable** — no hidden prompt fragments.

Style:

- Strict TS, no `any` at module boundaries.
- Comment the **why**, not the **what**.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- `npm run lint && npm run test && npm run build` clean before opening a PR.

---

## License

MIT. See [`LICENSE`](./LICENSE).

---

## Acknowledgements

- [`twitter-text`](https://github.com/twitter/twitter-text) — Twitter/X's official tweet parser, the canonical implementation of weighted length.
- [WXT](https://wxt.dev) — Chrome extension framework, takes the manifest pain away.
