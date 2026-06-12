# Margin

_In the margin of X._

A Chrome extension scratch pad for composing X.com posts and replies in your own voice. You bring your own Anthropic API key. The extension reads the tweet you're replying to, samples your saved writing for voice, and drafts something that sounds like you — which you copy into X and finish by hand.

It is an **honest LLM wrapper for a specific job**: visible prompts, editable templates, exclusion rules you control, deterministic counting, and clipboard-only output. The whole thing is ~8,000 lines of TypeScript (plus ~2,100 lines of tests) and is meant to be read end-to-end.

This repo is public, MIT-licensed, and ships no telemetry of any kind.

---

## What it does

- **Capture** your own tweets from x.com with a click-to-save mode that hard-filters on your handle.
- **Generate** post and reply drafts in your voice using sampled examples from your captured library + a style guide + your bullets. Starred examples are guaranteed into every prompt as "you at your best."
- **Compose threads** as first-class drafts: ordered ≤280 cards with per-post copy, a soft ≈N length target, and thread-aware refines — seeded by your own saved threads (captured whole from X with one click on the thread page).
- **Bundle** specific tweets as a reusable voice seed (e.g. a "day X" series): the bundle's members become the exact voice examples for that draft, and shipped drafts file back into the bundle automatically.
- **Refine** the on-screen draft via chips (Shorter / Longer / Warmer / Punchier — all editable) or a freeform feedback box in your own words.
- **Regenerate** to reshuffle examples and bump temperature when a draft doesn't land.
- **Enforce** deterministic output rules: em dashes auto-fix to commas, smart quotes auto-fix to straight, staccato runs and a do-not-say banlist trigger one repair re-prompt and highlight residue.
- **Count** characters with X's official `twitter-text` weighting (URLs always weigh 23, some characters weigh 2). Over-280 drafts get one automatic Tighten pass.
- **Copy** the result to clipboard. The extension never modifies X's page and never auto-posts.

---

## Security & privacy — read this before installing

**You are trusting this extension with an API key. We want to be honest about what that means.**

- The key is stored **unencrypted** in `chrome.storage.local` (or `chrome.storage.session` if you choose). It is protected only by your OS account and Chrome's extension sandbox. We deliberately **do not** fake at-rest encryption — a public repo's "encryption" would be reversible by anyone reading the code, and pretending otherwise would be dishonest.
- The blast radius of a key leak is bounded to **API spend** and is fully **revocable** in seconds at the Anthropic console.
- **Set a spend cap on your Anthropic key before using this extension.** This is the single most important thing you can do.
- The key is read **only by the background service worker** — never injected into the X.com page, never sent to a content script, and **never logged**. The settings field is write-only: the stored key is never read back into any page; the UI only knows whether a key is set.

**What actually leaves your machine:**

- The tweet you're replying to + your bullets + sampled examples go to **`api.anthropic.com`** as prompt content. That is inherent to using their API. The privacy claim is "no middleman server," not "nothing leaves your device."
- Avatar images render directly from **`pbs.twimg.com`** (X's public avatar CDN) — a one-way, body-less image GET the browser makes when the panel paints a captured tweet or library row. No user data, no key, no tweet content travels on that path, and the extension enforces the host both at capture and at render. You already load the same images on x.com itself.
- **Nothing else.** No telemetry, no analytics, no proxy server, no third-party hosts. The single `fetch()` in the codebase is in `src/api/anthropic.ts` and it targets exactly one URL.
- Your captured library lives in **IndexedDB** at the extension's own origin. The X page cannot read it. Nothing reads it except the background worker assembling a prompt.
- Settings are in `chrome.storage.local`. **Never `chrome.storage.sync`** — that would push data to Google's servers.

**What the extension cannot do** (enforced by manifest + code):

- Reach any host besides `api.anthropic.com` (background only), `pbs.twimg.com` (inbound images only), and the x.com/twitter.com pages it runs on. No `<all_urls>` permission.
- Modify X's DOM or auto-post. The Copy button is the only output path. The only things it ever adds to an x.com page are its own highlight overlays — every one tagged with a `data-margin-overlay` attribute (one `grep` finds them all), click-transparent except for a single dismiss button that only clears extension-side state.
- See your X content from anything but a user-initiated capture click.

You can verify all of the above in 30 seconds: open the background service worker's DevTools (`chrome://extensions` → "service worker" link) and watch the Network tab while generating. Exactly one outbound request to `api.anthropic.com/v1/messages`. No other hosts. Ever.

The full architectural contract is in [`CLAUDE.md`](./CLAUDE.md) — particularly §6 (security invariants) and §7 (data & privacy). The standing verification of those invariants is [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md), re-run against the tree it describes.

---

## Install (developer / unpacked)

The extension is not in the Chrome Web Store. Load it unpacked from your own build. Requires Chrome 116+.

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

Then open the panel (toolbar icon), click the gear to open **Settings**, and in the **Account** section:

1. Enter your X handle (the hard filter for what enters your library).
2. Paste your Anthropic API key. **Set a spend cap first.** The field is write-only — once saved you'll see "key is set", never the key itself.
3. Pick where the key lives: **Persistent** (`chrome.storage.local`, survives quits) or **Session only** (`chrome.storage.session`, cleared when Chrome fully exits).
4. **Save key**, then **Verify** — it checks the saved key with a tiny live request.

---

## Usage

### Capture your voice

1. Open the side panel on x.com and switch to the **Voice** screen.
2. Turn on **Save tweets from X**. Hovering tweets shows a highlight; clicking one of **your own** tweets saves it (the author must match your configured handle — anyone else's is rejected). Keyboard works too: **↑/↓** move the highlight tweet by tweet, **Enter** saves the highlighted one, **Esc** drops the highlight — and the keys work immediately, even while the panel still has focus.
3. Manage entries in Voice: search as you type (composes with the filter pills), edit text inline, override post/reply, delete, star your best ("you at your best" — guaranteed into every prompt).
4. Or paste text via the **+** (Add manually) form, ticking "This is my own writing."

### Bundles (seed a draft from specific tweets)

1. In Voice's **Bundles** section, hit **+**, tap tweets in the order you want them (the numbers are the stored order), name it, save — or save it empty and fill it later. Add to an existing bundle anytime: its row's **+** starts a pre-targeted pick (rows already in it show a check). Or build straight from X: set the capture banner's **"Also file into"** target — it can mint a new bundle inline — and every tweet you click files into the bundle as it saves (the paste form offers the same).
2. In Compose, the **Voice seed** picker sits beside the reply context: pick a bundle and its members become the _exact_ voice examples for that generation — no sampling, no topping up. Starred examples still ride on top. The inspector labels the call `generate (bundle: …)`. (Before you have any bundles it shows the default library sample and points you at Voice.)
3. When you copy a bundle-seeded draft (with "save shipped drafts" on), the shipped example **auto-files into the bundle** — a "day X" bundle grows itself with every entry you ship. The **On copy** row under the Copy button holds both switches (save to Voice, file into the bundle) so a one-off can opt out without touching the series.
4. Manage bundles in Voice: rename, reorder members (↑/↓), remove members, delete; click a member to jump to its row in Saved examples. Deleted library items show as "missing" in their bundles and are simply skipped when seeding.

### Threads

1. **Save one**: open your thread's page on X (click into it), turn on capture, click any post in it — the visible self-reply chain saves as one thread ("Saved as a thread · N posts"; scroll long threads fully into view first, and expand any "Show more" post). Or paste it via **Add manually → Thread**, separating posts with a line containing only `---`.
2. **Compose one**: flip the **Post ↔ Thread** switch, set the **≈N** target, generate. The draft arrives as ordered cards — edit any card in place, copy them one by one (the big button always offers the next uncopied post). Copying every card commits the thread; with the shipped loop on it saves back to Voice as a thread.
3. **Reshape**: chips and the steer box act on the whole thread (denser/warmer/etc.); changing **≈N** over the draft _repacks_ the same content into more or fewer posts; ≤280 applies per post.
4. **Refine one post**: each card has a **Rewrite** button (fresh take on that post, same beat — the rest of the thread untouched) and an **Aim** toggle that points the chips and the steer box at just that card. Only the changed card's copied check resets; **Undo** reverses a scoped refine like any other.

### Compose

1. **Post:** type bullets describing what you want to say, hit **Generate** (⌘↵ works).
2. **Reply:** turn on the **Reply to a tweet** toggle in Compose, then click the target tweet on x.com (or step to it with **↑/↓** and press **Enter**; **Esc** drops the highlight, or clears the lock when that's what's showing). It gets a highlight on the page (with a × to dismiss) and appears in the panel as the reply context — generation automatically becomes reply-mode. Click a different tweet to swap the context; turn the toggle off when done.
3. Shortcut: with X's native reply composer open, **Alt-Shift-R** opens the panel and pulls in the tweet you're replying to, in one step.
4. Toggle **Keep under 280** on/off per composition (the uncapped soft target is in Output rules).

### Refine

The draft appears with an X-weighted character counter. Reshape it without reshuffling:

- **Chips** (Shorter / Longer / Warmer / Punchier — editable in the Prompts section): one tap rewrites the current draft per the chip's stored instruction. Tapping the same chip again escalates it.
- **Steer it**: type what to change in your own words, then **Apply** (⌘↵).
- **Regenerate**: fresh samples + higher temperature. Use when a draft "didn't land" and you want a different angle.
- **Undo**: one level back.
- **Inspect last prompt** (bottom of Compose): every Anthropic call in the last invocation — generate/refine plus any repair or tighten pass — as the exact System/User text sent, with the raw response, all copyable.

### Copy out

Click **Copy to X**. Paste into X's compose box. Finish by hand. Once everything is copied, the button becomes **Done — next draft**: it clears the bench (draft, angle, reply context — your bundle seed and post/thread mode stay) with a few seconds of Undo. The trash icon up by the brief remains the other exit, for abandoning a draft you _didn't_ ship.

---

## Architecture (overview)

```
entrypoints/
  background/            The only code that reads the key or calls Anthropic.
    index.ts               listeners + typed message routing
    generation.ts          generate/refine pipeline + key verification
    capture.ts             capture validation + persistence
    tabs.ts                pushes to x.com tabs, composer round-trip
  twitter.content/       Read-only DOM contact with x.com.
    index.ts               state mirroring, click/hover routing, rAF loop
    extract.ts             every read of X's markup (pure Element → data, fixture-tested)
    overlay.ts             the §6 overlay carve-out (the only page writes)
  sidepanel/, options/   React entries.

src/
  lib/                   Pure, framework-free, fully tested.
    counting/            twitter-text weightedLength wrapper.
    exclusion/           Structural + do-not-say detectors, auto-fix, check.
    prompt/              Templates (single source of defaults), slot engine, assembly.
    sampling/            selectExamples (the CLAUDE.md §8 retrieval seam; bundles seed it).
    bundles/             Bundle member resolution + append (honest missing counts).
    draft/               The draft lifecycle state machine + the commit event.
    library/             Corpus dedupe (id/text identity, source precedence).
    replyContext/        Same-tweet merge for X's metadata-poor re-renderings.
    overlay/             The on-page render-visibility policy.
    url/                 isXPageUrl (off-X detection without the "tabs" permission).
    screening/           Quality predicates (dormant until archive import).
    voice/               validateAuthor (hard filter), classifyType.
    format/              relative timestamps, x.com style.
  api/anthropic.ts       The fetch wrapper. Imported by background/generation.ts only.
  storage/               chrome.storage.* (local/session) + versioned IndexedDB corpus.
  messaging/             Typed contracts + envelope (request/reply + broadcast notice).
  types/                 LibraryItem, Draft = { posts[] }, Settings, ...
  ui/                    React components (compose/, voice/, sections/).
```

**Boundaries** (verified by `grep` — see `SECURITY-AUDIT.md` for the exact commands):

- `getApiKey` callers: `entrypoints/background/generation.ts`. One file. The options page is write-only.
- `src/api/` imports: the background's generation module (and its own test).
- `fetch()` calls: 1, in `src/api/anthropic.ts`, to `https://api.anthropic.com/v1/messages`.
- Content script imports: zero from `api/` or `storage/key`.

**Stack**: WXT + React + TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, type-checked ESLint + Prettier, `twitter-text`, `fake-indexeddb`/`happy-dom` (test only). No Anthropic SDK — a one-file `fetch` wrapper you can read in a sitting is more honest for a public repo.

### Tests

459 tests across 28 files cover every load-bearing piece of deterministic logic: exclusion detectors (em-dash, smart quotes, staccato boundary 2-vs-3 + word-count edges, the narrow label-colon rule), the do-not-say whole-word matcher, mechanical auto-fix, twitter-text weighted counting, the prompt engine (slot rendering/validation, the system/user role boundary, default-template consistency), prompt assembly (slot population, intent-shape framing, refine voice anchor, violation summaries, chip escalation), `selectExamples` (stars, tiers, bundle seeding), bundle member resolution, the draft lifecycle state machine (both undo scopes, stale-request gating, the bundle-seed provenance), library dedupe, the reply-context merge, screening predicates, `validateAuthor`, `classifyType`, the settings merge + template migration, the Anthropic client (header/body shape, full error-mapping table, key never echoed — all against a stubbed `fetch`), the IndexedDB corpus + bundles stores incl. every seeded schema migration (v1 through v5), and the X-markup extraction layer via DOM fixtures (so when X drifts, the failing test names the assumption that died).

Per CLAUDE.md §5 there is no coverage-percentage gate. Behavior that matters is tested; UI glue and `chrome.*` wrappers aren't filler-tested.

```bash
npm run test       # vitest run (add --coverage for the report)
npm run lint       # eslint (type-checked tier), clean
npm run compile    # tsc --noEmit, clean
npm run format:check
npm run build      # production build → .output/chrome-mv3/
```

Dependency policy: `npm audit --omit=dev` must be clean (it is — production deps are react, react-dom, twitter-text). Dev-toolchain findings are tracked against upstream, not force-fixed.

---

## Roadmap (deferred from v1)

These are intentional v1 omissions. The code shape preserves the seams so they bolt on without a refactor:

- **Bulk archive import**: drag-and-drop an X data export (`.zip` / `tweets.js`) → the screening predicates (already tested, currently dormant) filter the firehose. Exports already carry a schema version for the future import to validate.
- **Semantic retrieval**: `selectExamples(mode, context, library) => examples[]` is the one function to replace. `LibraryItem.embedding` is `null` in v1 but the IndexedDB schema reserves the column (and a `byType` index).
- **Model picker**: the model id is shown read-only in Account; a picker needs per-family parameter gating (newer Opus models reject `temperature`).
- **Image / quote-tweet understanding**: reply context capture is text-only today.
- **Localised reply detection**: the structural heuristics work via DOM structure; a localised "Replying to" text match would harden the feed-view signal.
- **Auto-expand truncated tweets on capture**: X gates "Show more" behind `event.isTrusted`, which only real user input produces; the only workaround (`chrome.debugger`) is disproportionate for this threat model. We detect truncation and ask you to expand it yourself.

---

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) first. It is the authoritative operating guide and overrides convenience.

Hard rules a PR must respect:

- The API key never leaves the background worker. `src/api/` is imported only by `entrypoints/background/`.
- Storage is `chrome.storage.local` / `.session` and IndexedDB — never `chrome.storage.sync`.
- Content scripts never modify X's DOM. The overlay carve-out (CLAUDE.md §6) is the only page-write surface; everything it renders carries `data-margin-overlay`.
- Host permissions stay limited to x.com / twitter.com. The single external API host is `api.anthropic.com`; the single inbound image host is `pbs.twimg.com`.
- Pure logic in `src/lib/` ships with tests. UI glue does not need tests for the sake of percentages.
- Prompts and instructions are **visible and editable** — no hidden prompt fragments.

Style:

- Strict TS, no `any` at module boundaries.
- Comment the **why**, not the **what**.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`), one logical change per commit.
- `npm run lint && npm run format:check && npm run compile && npm run test && npm run build` clean before opening a PR.

---

## License

MIT. See [`LICENSE`](./LICENSE).

---

## Acknowledgements

- [`twitter-text`](https://github.com/twitter/twitter-text) — Twitter/X's official tweet parser, the canonical implementation of weighted length.
- [WXT](https://wxt.dev) — Chrome extension framework, takes the manifest pain away.
