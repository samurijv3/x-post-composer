# architecture.md — system structure as built

How Margin is put together on this branch. Decisions and intent live in `design.md`; per-module contracts in `components.md`; end-to-end traces in `slices.md`. Security invariants are normative in `CLAUDE.md` §6 and verified in `SECURITY-AUDIT.md`.

## Module map

```
┌─ side panel ──────────────────┐   ┌─ options page ─────────────────┐
│ entrypoints/sidepanel/main.tsx│   │ entrypoints/options/main.tsx    │
│  · port heartbeat (20s)       │   │ src/ui/OptionsPage.tsx          │
│ src/ui/App.tsx (PanelShell)   │   │  · sections/{Account,OutputRules│
│  · ComposeScreen + ui/compose/│   │    Prompts(+prompts/),Data}     │
│  · VoiceScreen   + ui/voice/  │   └────────────┬────────────────────┘
└──────────┬────────────────────┘                │
           │  typed messages (src/messaging/)    │  direct storage reads/writes
           │  + chrome.storage subscriptions     │  (settings, corpus, theme)
┌──────────▼────────────────────────────────────▼─────────────────────┐
│ background worker — entrypoints/background/                          │
│  index.ts      listeners + message routing only                      │
│  generation.ts sample→assemble→CALL→autoFix→repair?→tighten?         │
│                ── the ONLY reader of the key / caller of Anthropic ──│
│  capture.ts    author filter → classify → persist → notices          │
│  tabs.ts       pushToTabs, composer round-trip, active-tab-on-X      │
└──────┬──────────────────────────────┬────────────────────────────────┘
       │ tabs.sendMessage             │ fetch (60s abort)
┌──────▼─────────────────────────┐   ▼
│ content script —               │  api.anthropic.com/v1/messages
│ entrypoints/twitter.content/   │  (src/api/anthropic.ts)
│  index.ts   state mirror, click│
│             /hover routing, rAF│      shared by everything:
│  extract.ts X-DOM reads only   │  src/lib/      pure brain (tested)
│  overlay.ts page writes only   │  src/storage/  local/session + IDB
│             (§6 carve-out)     │  src/messaging/ typed contracts
└────────────────────────────────┘  src/types/    shared shapes
```

## Surfaces and what each may (not) do

| Surface           | Lives in                             | May                                                                                                | Must never                                                                       |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Background worker | `entrypoints/background/`            | Read the key, call Anthropic, write the corpus, push state to tabs, broadcast notices              | Touch the DOM; trust message payload shapes without the contract types           |
| Content script    | `entrypoints/twitter.content/`       | Read X's DOM (`extract.ts`), append its own overlay elements (`overlay.ts`), send one-way messages | Import `src/api/` or `src/storage/key`; modify X's tree; hold the key; auto-post |
| Side panel        | `entrypoints/sidepanel/` + `src/ui/` | Read/write storage (not the key value), request work via `sendToBackground`, write clipboard       | Read the key value; call `fetch`                                                 |
| Options page      | `entrypoints/options/` + `src/ui/`   | Same as panel; additionally **write** the key (`setApiKey`) and check presence (`hasApiKey`)       | Read the key value back (`getApiKey` is background-only)                         |

## Brain / shell split

All consequential logic is pure and framework-free in `src/lib/` (no React, no `chrome.*`, no `fetch`, no DOM): exclusion engine, prompt engine + assembly, sampling, counting, screening, voice validation/classification, formatting, the overlay render policy, the on-X URL predicate. The shells compose it.

**One deliberate exception:** `entrypoints/twitter.content/extract.ts` is consequential logic that necessarily reads DOM (`Element → data`). It lives inside the content entrypoint, not `lib/`, and gets the lib treatment anyway: pure functions of their arguments, every X-markup assumption pinned by DOM-fixture tests (`extract.test.ts`).

Mechanical test before adding logic anywhere else: _could this function run under plain Vitest with no stubs?_ If yes, it belongs in `src/lib/`.

## End-to-end data flow (generation)

```
X DOM ──extract.ts──▶ ReplyContext ──storage.session lock──▶ panel card
                                                                │
user bullets + charCap ─────────────── panel:generate ─────────▶ background/generation.ts
                                                                │
IndexedDB corpus ──getAllItems──▶ selectExamples(mode, ctx, lib, {poolSize})   [lib/sampling]
                                                                │
settings templates ──assembleInitialPrompt(request, settings,    [lib/prompt/assemble]
                     {voice, aspirational})──▶ {system, user}
                                                                │
callAnthropic { system, prompt: user }                          [api/anthropic]
                                                                │
draft text ──▶ autoFix (em dash→comma, curly→straight)          [lib/exclusion]
           ──▶ checkExclusions ──violations?──▶ ONE repair call ──▶ autoFix+check again
           ──▶ charCap && isOver280? ──▶ ONE tighten call        [lib/counting]
                                                                │
setLastPrompt (session, per-call records) ◀──┘                  │
GenerationResult { draft.posts[0], appliedAutoFixes, residualViolations, wasRepaired }
                                                                │
panel: renderWithHighlights(draft, residual) ──▶ user edits/refines ──▶ Copy → clipboard
```

Hard property: **≤ 3 Anthropic calls per generate/refine invocation** (initial + optional repair + optional tighten). Refine is the same pipeline minus sampling — it reshapes `previousDraftText` from the panel. Every call in the pipeline — chip/more-less refine, repair, tighten — renders through `assembleRefinePrompt` (the one refine template) and so carries the same system voice anchor (role + precedence + style guide + exclusions) as generation; repair and tighten get code-supplied instructions (`buildRepairInstruction`, `TIGHTEN_INSTRUCTION`).

## Messaging

Single source of truth: `src/messaging/contracts.ts` — five discriminated unions, names prefixed by sender role.

| Union                 | Direction                 | Carried by                                                                        |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `PanelToBackground`   | panel/options → worker    | `sendToBackground` (awaits a typed reply; `bg:error` rejects)                     |
| `ContentToBackground` | content → worker          | `sendOneWay` (fire-and-forget, throw-proof) or raw send for the check-\* requests |
| `BackgroundReply`     | worker → requester        | `onMessage` handler return value                                                  |
| `BackgroundToContent` | worker → content via tabs | `tabs.pushToTabs` / `tabs.sendMessage`                                            |
| `BackgroundNotice`    | worker → any open surface | `broadcastNotice` / `onNotice`                                                    |

`isMessageOfType` narrows by the `type` tag. The worker's `onMessage` (in `envelope.ts`) converts thrown errors into `bg:error` replies so senders never time out. No `externally_connectable`: web pages and other extensions cannot reach `onMessage` at all.

**Panel-liveness protocol (MV3-critical).** Content scripts paint overlays only while a panel is open. The signal: the panel connects a `margin-panel` port and **heartbeats it every 20 s** (`sidepanel/main.tsx`), reconnecting on disconnect. Why: an MV3 worker dies after ~30 s idle and an _open port does not prevent that — only messages reset the timer_ (Chrome 114+). The heartbeat keeps the worker (and its in-memory `openPanelPorts` set) alive exactly while a panel exists. Content scripts treat `panelOpen` as a **lease**: re-checked on `visibilitychange` and every 30 s while believed open, so a worker crash can't leave overlays painting on a closed panel.

**Keyboard-shortcut protocol.** `Alt-Shift-R` → background opens the panel **first** (gesture window — no awaits before `sidePanel.open()`), then stamps the one-shot `autoReplyCapture:v1` session flag and broadcasts `bg:auto-reply-capture` **with the same timestamp**. A panel opened by the shortcut consumes the flag on mount (stale > 15 s ignored); an already-open panel hears the broadcast; the shared stamp dedupes the pair. Either path runs `panel:capture-reply-context` → composer extraction → lock.

## Storage

| Store                    | Key / name                                            | Contents                                         | Lifetime                |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------ | ----------------------- |
| `chrome.storage.local`   | `settings:v1`                                         | `Settings` (merged over defaults on read)        | persistent              |
|                          | `themePreference:v1`                                  | `'light' \| 'dark'`                              | persistent              |
|                          | `apiKey:v1` (when mode = `local`)                     | the key, write-only from UI                      | persistent              |
| `chrome.storage.session` | `apiKey:v1` (when mode = `session`)                   | the key                                          | until full browser quit |
|                          | `activeCaptureMode:v1`                                | `'none' \| 'library' \| 'reply-context'`         | session                 |
|                          | `replyContextLock:v1`                                 | `ReplyContext`                                   | session                 |
|                          | `lastPrompt:v2`                                       | per-call prompt records (`calls[]`) + response   | session                 |
|                          | `autoReplyCapture:v1`                                 | one-shot shortcut stamp (consumed on read)       | seconds                 |
| IndexedDB                | db `x-post-composer`, store `items`, `DB_VERSION = 4` | `LibraryItem` rows, keyPath `id`, index `byType` | persistent              |

`chrome.storage.sync` is forbidden (CLAUDE.md §6). Content scripts cannot read `storage.session` (Chrome default trusted-only) — they mirror state via messaging, which is also what keeps the session-mode key out of their reach.

**IndexedDB migration path** (`src/storage/corpus.ts`): one migration-pass FUNCTION per schema version, registered for `oldVersion < N` and run **sequentially** — v1 created the store+index, v2 backfilled `authorDisplayName`/`authorAvatarUrl`, v3 collapsed the source taxonomy (`capture`→`manual`, `import`→`archive`; `shipped` added), v4 backfilled `favorite: false` (the Star tier). Sequential is load-bearing: two concurrent cursors interleave and `cursor.update` writes the full row each cursor read, so the later pass's stale read erases the earlier pass's fields. Rule: bump `DB_VERSION`, **add** a new pass function, never edit an existing one, add a migration test that seeds the old shape (pattern in `corpus.test.ts`). `EXPORT_SCHEMA_VERSION` is derived from `DB_VERSION`.

`getSettings()` merges stored values over `DEFAULT_SETTINGS` per-field (nested merges for `temperature`/`structuralRules`; per-template merge resets legacy single-body or blanked templates to the current defaults — the v1→v2 template migration, see roadmap.md Build Decisions Log) — so adding a settings field needs no migration, just a default. `setSettings` is read-merge-write with a documented single-writer-per-field assumption.

## Security boundary (the key)

```
options AccountSection ──setApiKey (write-only; hasApiKey for presence)──▶ chrome.storage local|session
                                                                                │
                              entrypoints/background/generation.ts ──getApiKey─┘
                                            │
                              src/api/anthropic.ts → x-api-key HEADER only → api.anthropic.com
```

- `getApiKey` has **exactly one calling file**: `entrypoints/background/generation.ts`. The options page never reads the value back.
- `src/api/anthropic.ts` is imported by that file (and its own test) only. The content-script bundle contains zero key plumbing — verified in `SECURITY-AUDIT.md` item 14.
- No message contract carries a key field; the key never enters prompt text, logs, or error messages (pinned by `anthropic.test.ts`).
- `api.anthropic.com` is deliberately **not** in `host_permissions` — the worker's fetch is CORS-bound and rides the `anthropic-dangerous-direct-browser-access` header. Tighter than whitelisting the host.
- Inbound images: `pbs.twimg.com` only, enforced at capture (`extract.ts readAvatarUrl`) **and** at render (`src/ui/Avatar.tsx`).

Page contact: read-only plus the overlay carve-out (`overlay.ts` is the only file that appends to an x.com page; every element carries `data-margin-overlay`; visuals are `pointer-events: none`; the dismiss button is the single interactive child and only clears extension state). Tweet text is page-controlled input — it flows only into prompt text and React-escaped rendering; there is no HTML-injection sink in the codebase (no `innerHTML` anywhere, tests included).

## MV3 facts this code depends on

- Worker idles out after ~30 s; **messages**, not open ports, reset the timer → the panel heartbeat.
- Worker memory is disposable → all cross-restart state is in storage; `openPanelPorts` is the one in-memory set, and the lease protocol tolerates losing it.
- `chrome.sidePanel.open()` requires a user gesture (Chrome 116+) and must run before other awaits in the handler.
- `minimum_chrome_version: 116` in the manifest is the floor for all of the above plus the `oklch`/`color-mix` CSS.
- Manifest is declared in `wxt.config.ts`; WXT generates the rest. Default MV3 CSP — never weaken it.
