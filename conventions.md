# conventions.md — enforceable rules

Checkable rules for working in this repo. CLAUDE.md is the constitution (it wins on conflict); this is the statute book. Most rules below carry a one-command check.

## The gate

**`npm run verify` must be green before every commit.** It chains eslint (type-checked tier) → prettier check → `tsc --noEmit` → vitest → production build. No "fix lint in a follow-up", no committing on red. CI-of-one: you are the CI.

## Code rules

1. **Brain/shell (CLAUDE.md §3).** If a function could run under plain Vitest with no stubs, it lives in `src/lib/` with a test. Shells (`entrypoints/`, `src/ui/`, `src/storage/`) orchestrate; they do not decide. The one standing exception is `entrypoints/twitter.content/extract.ts` (DOM-reading by necessity, fixture-tested like lib). Check: `src/lib/` must never import `react`, `chrome`, or call `fetch` — every hit from `grep -rn "from 'react'\|chrome\.\|fetch(" src/lib/` must be a prose comment (today: exactly one, the header of `assemble.ts`); any hit in code is a violation.
2. **No speculative abstraction.** Abstract on the third repetition. No layer, interface, config option, or "flexibility" without a current second consumer — the only sanctioned future-proofing is the four CLAUDE.md §8 seams (`Draft.posts[]`, `LibraryItem.embedding`, `selectExamples`, versioned IDB) plus the documented dormant pieces (`lib/screening`, the `byType` index, `EXPORT_SCHEMA_VERSION`). A settings field nothing reads is dead code, not a seam (we deleted one — `manualCorpusBalance`).
3. **One job per file, ~200-line guideline.** Over the line is fine only when it's still one responsibility (current honest outliers: `twitter.content/index.ts` ~450 — event wiring; `generation.ts` ~290 — the pipeline). Two separable jobs in one file = split now. Check: `wc -l` anything you touched.
4. **Single source of truth per fact.** Default prompts: `DEFAULT_PROMPT_TEMPLATES` only. Slot parsing: `extractSlotNames` only. The system/user role boundary: the two `PromptTemplate` bodies (`system`/`user`) only — structural, never re-derived by splitting a joined string (the `===USER===` marker and `splitPrompt` are gone; don't reinvent them). Message shapes: `contracts.ts` only. Duplicating any of these (even in UI "for convenience") is the bug class that caused ARCH-01/ARCH-03 — don't reintroduce it.
5. **Comments say why; stale comments are bugs.** Every exported function gets a short JSDoc. If you change behavior, update every comment that described it **in the same commit** — a comment that lies is worse than none (Phase 2 fixed twelve). No private dev-log jargon in a public repo.
6. **Errors are never swallowed.** Every failure reaches the user with a next step (banner kinds, error cards, toasts). The single sanctioned silence: `no-tweet-under-cursor` in capture mode. An empty `catch {}` is allowed only to suppress expected teardown noise and must say so in a comment (pattern: `sendOneWay`).
7. **Strict TS discipline.** No `any` at module boundaries; an unavoidable cast gets a comment naming the boundary (the one example: `sendToBackground`'s protocol-boundary assertion). Type-checked lint stays on; don't disable a rule file-wide to ship — fix or justify per-line.
8. **Security invariants are CLAUDE.md §6 — re-verify, don't re-derive.** Touching anything under `src/api/`, `src/storage/key.ts`, `src/messaging/`, `entrypoints/background/generation.ts`, `entrypoints/twitter.content/`, or `wxt.config.ts` manifest? Re-run the relevant `SECURITY-AUDIT.md` checks before committing, and re-stamp that file if its claims changed. Hard tripwires: a second `getApiKey` caller, a second `fetch`, any `innerHTML`, any new host, `storage.sync`, an overlay element without `data-margin-overlay`.
9. **Framework facts get looked up, not remembered** (CLAUDE.md §2): WXT APIs at wxt.dev, model ids at docs.claude.com, MV3 behavior at developer.chrome.com. The MV3 facts the code already depends on are recorded in `architecture.md` — don't contradict them casually.

## Git rules (the Phase-2 practice, now law)

- **Conventional Commits**: `type(scope): imperative summary ≤ ~72 chars`. Types: `feat` `fix` `refactor` `test` `docs` `chore` `perf`. Scope = module or surface (`content`, `prompt`, `account`, `mv3`, …) when it helps. Body explains _why_ when not obvious; reference IDs where they exist (`Refs AUDIT.md NEW-01`).
- **Atomic commits — one logical change.** Never mix a refactor with a behavior change. Formatting-only commits stay formatting-only. Tests travel in the same commit as the behavior they pin.
- **Branch per work chunk**, named `type/short-topic` (`chore/codebase-hardening`, `feat/archive-import`). `main` only receives verified branches; linear history; no `wip` commits, no force-pushing shared branches.
- **Every commit leaves the tree green** (`npm run verify`), not just the last one — history must bisect.
- **Don't rewrite published history.** Bad old commits stay; the convention applies going forward.

## Scope discipline

- Implement what was asked. Mid-task discoveries get **recorded** (a line in `AUDIT.md`-style notes or the relevant doc), and fixed only when low-risk and clearly correct — say that you did.
- Declining is allowed: if a finding/request turns out wrong or riskier to change than keep, leave the code and write down why.
- A feature that violates a `design.md` non-goal or a `roadmap.md` "Deliberately Not Building" item is declined, not negotiated into the codebase.

## Doc maintenance — part of "done"

The doc set is ground truth only while it's maintained. **A change isn't done until the docs that describe the changed thing are updated in the same commit series.**

| You changed…                                                                                                        | Update                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Product behavior, a flow, a non-goal                                                                                | `design.md` (+ `README.md` if user-visible)                                                         |
| Forward-looking scope/sequencing; settled a "decide at build" question; made any recordable judgment call mid-build | `roadmap.md` — its Build Decisions Log is **append-only**: add a dated entry, never edit an old one |
| Shipped a roadmap phase                                                                                             | `roadmap.md` (mark it) + graduate its rationale into `design.md`                                    |
| Surfaces, data flow, messaging, storage schema, security boundary                                                   | `architecture.md` (+ `SECURITY-AUDIT.md` re-run if §6-adjacent)                                     |
| Any module added/removed/re-contracted                                                                              | `components.md` (its registry row)                                                                  |
| A flow's path through the system; a new feature slice                                                               | `slices.md`                                                                                         |
| Test patterns, what's tested/untested, counts that docs cite                                                        | `testing.md`                                                                                        |
| A rule itself                                                                                                       | this file, and `CLAUDE.md` if constitutional                                                        |
| Invariants, seams, the stack, must-test list                                                                        | `CLAUDE.md` — keep it authoritative; never silently diverge                                         |

Staleness detectors a reviewer (or model) can run: file paths named in docs must exist; counts cited in `testing.md`/`README.md` match `npm run test` output; `SECURITY-AUDIT.md` paths resolve.

## When X breaks the extension

X markup drift shows up as failing `extract.test.ts` fixtures (each names its assumption) or as `unreadable` banners in the field. Fix = update the selector logic in `extract.ts` **and** its fixture in the same commit. Degrade gracefully — extraction returns null/error tags, never throws into the page.
