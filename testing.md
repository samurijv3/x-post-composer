# testing.md — the test strategy as it stands

Normative rule: CLAUDE.md §5 — every load-bearing piece of deterministic logic has a behavioral test; **no coverage-percentage gate, no filler tests**. This file is the how.

Current state: **470 tests, 28 files**, all green via `npm run test`.

## Stack and config

- **Vitest 4** with `globals: true`, environment **happy-dom**.
- `vitest.setup.ts` installs **fake-indexeddb** globally (corpus tests run against a real IDB implementation).
- `vitest.config.ts` pins **`TZ=UTC`** — `formatRelativeTweetTime` deliberately uses local date parts (it mirrors what x.com shows), so expectations are timezone-dependent without the pin.
- Test discovery: `src/**/*.test.ts(x)` **and** `entrypoints/**/*.test.ts` (the extraction fixtures live beside `extract.ts`).
- Tests sit next to the code they cover. No `__tests__` directories, no snapshot tests.

## What is tested, and why

| Area                                                           | Files                                                        | Why it's load-bearing                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclusion engine (detectors, banlist matcher, auto-fix, check) | `src/lib/exclusion/*.test.ts` (4)                            | Decides what gets flagged/rewritten in every draft                                                                                                                                                                                                |
| Prompt engine + defaults + assembly                            | `src/lib/prompt/{template,defaults,assemble}.test.ts`        | Decides the exact text sent to Anthropic; pins template invariants (single source, the system/user role boundary — per-call slots never in system — zero slot drift)                                                                              |
| Sampling                                                       | `src/lib/sampling/selectExamples.test.ts`                    | The §8 seam — Concept A stars/tiers, Phase 6 bundle seeding, Phase 10 thread mode (tweet-equivalent budget, starred-threads-first, post top-up, cold start)                                                                                       |
| Threads (wire format)                                          | `src/lib/thread/parse.test.ts`                               | THE `---` segment encoding everything speaks — parse/join round-trip, tolerance, narrow numbering-strip                                                                                                                                           |
| Bundles                                                        | `src/lib/bundles/resolveMembers.test.ts`                     | Member resolution order, honest missing counts, append- and move-with-identity-return (reorder skips dangling slots) — what auto-filing, reorder, and every bundle count in the UI rely on                                                        |
| Counting                                                       | `src/lib/counting/twitter.test.ts`                           | The 280 gate must agree with X (URL = 23, emoji weights)                                                                                                                                                                                          |
| Voice                                                          | `src/lib/voice/{validateAuthor,classifyType}.test.ts`        | The capture hard-filter and post/reply classification                                                                                                                                                                                             |
| Screening (dormant)                                            | `src/lib/screening/predicates.test.ts`                       | Kept load-bearing so Phase-2 import bolts onto tested filters                                                                                                                                                                                     |
| Formatting                                                     | `src/lib/format/relativeTime.test.ts`                        | User-visible timestamps incl. clock-skew behavior                                                                                                                                                                                                 |
| Overlay render policy                                          | `src/lib/overlay/visibility.test.ts`                         | Decides what may paint on x.com (panel/modal/navigation gates — the §6 disappear rules)                                                                                                                                                           |
| Draft lifecycle + commit hook + bullet transforms              | `src/lib/draft/{lifecycle,commit,bullets}.test.ts`           | The multi-post state machine: stale gating, both undo scopes, per-post hand edits/copied flags, the all-copied commit rule, the done exit (committed-only, workbench snapshot), the post-replaced splice (scoped refines), targetCount carry-over |
| Library dedupe + search                                        | `src/lib/library/{dedupe,search}.test.ts`                    | Concept A: id/text identity, manual > shipped > archive precedence, never-downgrade, in-place promotion; the live-search predicate (token-AND, case folding, empty-query = all)                                                                   |
| Reply-context same-tweet merge                                 | `src/lib/replyContext/merge.test.ts`                         | Stops X's metadata-poor modal copies from degrading the lock (identity + field-wise enrichment)                                                                                                                                                   |
| On-X URL predicate                                             | `src/lib/url/isXPageUrl.test.ts`                             | Drives the panel's off-X overlay; "URL invisible to us" must read as off-X                                                                                                                                                                        |
| Settings merge + migration                                     | `src/storage/config.test.ts`                                 | Decides whether saved settings survive upgrades (blanked-template restore, nested merges, empty-banlist preservation)                                                                                                                             |
| Corpus + IDB migration                                         | `src/storage/corpus.test.ts` + `src/storage/bundles.test.ts` | CRUD (items + bundles), duplicate-id constraint, single-tx clear of BOTH stores, and real seeded migrations (v1→v3 chain, v2→v3 taxonomy collapse, v3→v4 favorite backfill, v4→v5 bundles store)                                                  |
| Anthropic client                                               | `src/api/anthropic.test.ts`                                  | Request shape (key in header only, never in body/errors), the full HTTP-status → error-kind table, text-block extraction — all against a stubbed `fetch`, no network                                                                              |
| X-markup extraction                                            | `entrypoints/twitter.content/extract.test.ts` (59 tests)     | Each test pins one assumption about X's DOM — incl. the self-reply spine walk (root finding, foreign-stop, reply-root degrade, truncation); when X drifts, the failing test **names the assumption that died**                                    |

## Deliberately untested (don't add filler here)

- React components and JSX glue — rendering is visually verified; the logic they call is tested underneath.
- Thin `chrome.*` storage wrappers (`captureMode`, `replyContextLock`, `lastPrompt`, `theme`, `autoReplyFlag`, `key.ts` plumbing) — a get/set/subscribe around one API call has nothing to assert beyond the mock.
- `src/messaging/envelope.ts` and the entrypoint wiring (`background/index.ts`, `twitter.content/index.ts`, `overlay.ts`) — chrome-API choreography; the decisions they route are tested in lib.
- Styling.

If one of these grows real logic, the logic moves to `src/lib/` and gets tested there — that's the rule, not "start testing the shell."

## Running

```bash
npm run test              # one-shot
npm run test:watch        # watch mode
npx vitest run --coverage # v8 coverage (provider is a devDependency)
```

**Reading coverage — known trap:** Vitest 4's text reporter **omits files at 100%**. `lib/prompt`, `lib/voice`, `lib/screening` not appearing in the table means they are fully covered, not uncovered. Check the summary totals, or pass explicit `--coverage.include` globs to see 0% files.

## Adding a test — patterns already in the repo

- **Pure lib function:** plain `describe/it` beside the file. Build fixtures with the local helper pattern (`item(...)`/`makeItem(...)` for `LibraryItem`, `span(...)` for `Span`) — copy from `assemble.test.ts` or `selectExamples.test.ts`.
- **Randomness:** never assert on `Math.random` — inject (`selectExamples`'s `rng` option, `seqRng` helper).
- **Time:** never `Date.now()` in expectations — inject `now` (`relativeTime.test.ts`) and rely on the UTC pin.
- **`chrome.storage` consumers:** stub with `vi.stubGlobal('chrome', {...})` backed by an in-memory record; drive the public functions, not internals — copy `config.test.ts`. `vi.unstubAllGlobals()` in `afterEach`.
- **Network:** stub `vi.stubGlobal('fetch', vi.fn(...))` with minimal `Response`-shaped objects; assert on the captured `RequestInit` for request-shape tests — copy `anthropic.test.ts`. Never use a real key string pattern beyond `sk-test-…`.
- **DOM fixtures:** build markup via `DOMParser().parseFromString(...)` (the `fromHTML` helper in `extract.test.ts`) — **not `innerHTML`**, which would trip the SECURITY-AUDIT injection-sink grep. Control the URL with `window.happyDOM.setURL(...)` (the `setPath` helper); reset `document.body` in `afterEach`.
- **IDB migration:** hand-seed the OLD schema version with raw `indexedDB.open(DB_NAME, oldVersion)`, then `_resetCorpusCache()` and read through the public API — copy the v1→v2 test in `corpus.test.ts`. Every future `DB_VERSION` bump needs one of these.

## Standing obligations

- A bug fix in `src/lib/`, `src/storage/`, `src/api/`, or `extract.ts` ships with a regression test **in the same commit**.
- New X-markup assumption in `extract.ts` → new fixture test naming it.
- Behavioral assertions only: test what the function promises, not how it's written. If a refactor with identical behavior breaks a test, the test was wrong.
