# Handoff: Margin — X Post Composer redesign

## Overview
**Margin** is a redesign of the existing "X Post Composer" Chrome extension — a side‑panel scratch pad that drafts X.com posts and replies in your own voice using your Anthropic API key. This package covers the full redesign: the **side panel** (Compose + Voice) and the **full‑page options/settings** view (Account, Output rules, Prompts, Data).

The redesign's intent: make an honest LLM‑wrapper feel **composed, hierarchical, and quietly at home next to X** — not flashy, not "magical." Personality lives in restraint, plain‑spoken microcopy, and structural continuity with X (pulled‑in tweets and saved examples read like tweets). The one muted‑blue accent, system UI font, and `oklch` neutrals are deliberate.

---

## About the design files
The files in this bundle are **design references created in HTML/React‑via‑Babel** — runnable prototypes that show intended look and behavior. **They are not production code to copy.** Your task is to **recreate these designs inside the existing extension codebase** (WXT + React + TypeScript, with `chrome.storage`, IndexedDB, a background service worker, and the `twitter-text` counter) using its established patterns — i.e. re‑skin/re‑structure `src/ui/Composer.tsx`, `VoiceTab.tsx`, `AccountTab.tsx`, `OutputRulesTab.tsx`, `PromptsTab.tsx`, `DataTab.tsx`, `Tabs.tsx`, etc. Do **not** drop the prototype's mock React into the app.

Open `Margin — X Post Composer.html` in a browser to explore the live prototype. It renders inside a mocked Chrome window for context; **that browser chrome and the dimmed timeline on the left are presentation scaffolding only.**

### Things in the prototype that are NOT product (do not build)
- **The Tweaks panel** (bottom‑right gear) — exploration tool. The toggles (nav pattern, vibe, density, accent, dark, demo‑error) are for *us* to compare options, not shipping settings. Ship: **muted‑blue accent, "quiet" vibe, comfortable density, follow system theme with a manual toggle.**
- **The "Preview" demo strip** inside Voice (visible when Saving is on) — a prototype affordance to trigger each save‑result message. In the real app these outcomes come from actually clicking tweets on x.com.
- **The dark Chrome window frame + grey timeline** — context only.
- **All data in `data.jsx`** — mock content. Wire to real storage/messaging.

---

## Fidelity
**High‑fidelity.** Final colors, typography, spacing, interactions, and copy. Recreate pixel‑accurately using the codebase's libraries. All tokens are in `styles.css` (`:root` for light, `[data-theme="dark"]` for dark). Design baseline width for the side panel is **384px** (Chrome side panels are user‑resizable; keep it fluid above ~320px). The options page is a normal full browser tab.

---

## Design tokens (from `styles.css`)
All color is `oklch`. Light is `:root`; dark overrides under `[data-theme="dark"]`. Accent is muted blue; alternates (slate/amber) are prototype‑only — ship blue.

**Light**
- bg `oklch(0.985 0.002 250)` · surface `oklch(0.998 0.001 250)` · surface‑2 `oklch(0.972 0.003 250)` · surface‑3 `oklch(0.948 0.004 250)` · inset `oklch(0.965 0.003 250)`
- border `oklch(0.905 0.004 255)` · border‑strong `oklch(0.84 0.006 255)` · hairline `oklch(0.93 0.003 255)`
- text `oklch(0.255 0.012 260)` · text‑2 `oklch(0.46 0.012 260)` · text‑3 `oklch(0.6 0.01 260)` · text‑faint `oklch(0.72 0.008 260)`
- accent `oklch(0.56 0.12 250)` · accent‑hover `oklch(0.5 0.13 250)` · accent‑press `oklch(0.45 0.13 250)` · accent‑weak `oklch(0.95 0.028 250)` · accent‑weak‑2 `oklch(0.9 0.045 250)` · accent‑line `oklch(0.78 0.07 250)` · on‑accent `oklch(0.99 0.005 250)`
- ok `oklch(0.56 0.1 155)` / ok‑weak `oklch(0.94 0.04 155)` · warn `oklch(0.62 0.11 75)` / warn‑weak `oklch(0.95 0.05 85)` · danger `oklch(0.55 0.16 25)` / danger‑weak `oklch(0.95 0.04 25)`

**Dark**
- bg `oklch(0.17 0.008 260)` · surface `oklch(0.205 0.009 260)` · surface‑2 `oklch(0.245 0.01 260)` · surface‑3 `oklch(0.285 0.012 260)` · inset `oklch(0.225 0.01 260)`
- border `oklch(0.31 0.012 260)` · border‑strong `oklch(0.4 0.014 260)` · hairline `oklch(0.27 0.01 260)`
- text `oklch(0.95 0.005 260)` · text‑2 `oklch(0.74 0.01 260)` · text‑3 `oklch(0.6 0.012 260)` · text‑faint `oklch(0.5 0.012 260)`
- accent `oklch(0.7 0.13 248)` · accent‑weak `oklch(0.32 0.06 250)` · accent‑weak‑2 `oklch(0.38 0.08 250)` · accent‑line `oklch(0.5 0.1 250)` · on‑accent `oklch(0.15 0.02 250)`
- ok `oklch(0.72 0.12 155)` · warn `oklch(0.78 0.12 80)` · danger `oklch(0.7 0.15 25)` (each with a `*-weak` ~`oklch(0.3–0.34 …)`)

**Type** — system UI stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, system-ui, sans-serif`. Mono (counts, prompt text, slots): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.
Sizes: xs 11 · sm 12 · base 13 · md 14 · lg 16 · xl 20 · 2xl 26 (px). Compact density drops base→12, md→13 and tightens padding.

**Radii** — xs 5 · sm 7 · base 10 · lg 14 · xl 18 · pill 999 (px).
**Spacing** — comfortable: pad 16, pad‑card 14, gap 12, gap‑sm 8. Compact: 12/11/9/6.
**Shadows** — sm `0 1px 2px oklch(0.4 0.02 260/0.06)`; base `0 2px 8px /0.08 + 0 1px 2px /0.05`; lg `0 12px 32px /0.14 …`. Dark uses black‑based shadows.
**Density/theme** are applied as `data-*` attributes on a wrapper; ship `data-theme` (light/dark) only.

---

## Brand
- **Name:** Margin. Tagline in the panel header: *"in the margin of X."*
- **Mark:** a rounded square (accent fill) with a vertical "ruled margin" line + two horizontal text lines, in `on-accent`. Built with plain elements (`.brand-mark .bm-rule`, `.bm-lines` in `styles.css`) — no SVG. Reproduce as a small inline component or SVG.
- **Voice:** plain‑spoken, concrete, lightly dry, candid; never cute, no exclamation points. Headings/labels stay crisp; *asides/hints* carry the dry register (often lowercase). Examples throughout the copy below.

---

## Screen 1 — Side panel shell (`panel.jsx`)
Fixed 384px column. Vertical flex: **header → (optional rail) → scrolling body → (optional tab bar) → toast**.

- **Header** (`.panel-head`, hairline bottom): brand mark + "Margin" / "in the margin of X" on the left. Right side icon buttons (30px, `.icon-btn`): a **Voice⇄Compose toggle** (mic icon on Compose, compose/pencil icon on Voice), a **theme toggle** (moon/sun), and a **gear** that opens the full‑page options. *(The gear icon must be a real cog — see `IcSettings` in `icons.jsx`; do not reuse the sun.)*
- **Body** renders the active screen (Compose or Voice).
- **Toast** (`.toast`): a dark pill, bottom‑center, with a check + message and an **optional action** (e.g. "Removed · **Undo**"). Auto‑dismisses ~1.8s, or ~5.2s when it carries an action.
- *Nav pattern is fixed to this "minimal" form for shipping (rail/tabs were prototype options).*

Primary navigation surfaces only **Compose** and **Voice** (the two things that touch X). All configuration lives on the full‑page options view, reached via the gear.

---

## Screen 2 — Compose (`panel-compose.jsx`) — the core loop
A single composing flow. **Replying is just attaching a tweet** — there is *no* Post/Reply mode selector. Intent is derived from whether reply context is attached.

### Pre‑draft state
1. **Reply attach** — if no context: a dashed full‑width button `.attach-reply` — icon + **"Reply to a tweet"** + hint *"pull in the post you're replying to."* If context attached: the reply‑context card (below).
2. **Input** — `.fld` label ("What do you want to say?" for a post, "Your angle" for a reply) + a 4‑row textarea. Placeholder is lowercase ("the topic / your angle / any detail to include"). **⌘/Ctrl+Enter generates.**
3. **Cap toggle** — a `.switch` "Keep under 280" (on by default). When off, shows "soft cap 1000".
4. **Generate** — full‑width primary `.btn.lg`: **"✦ Generate post"** or **"✦ Generate reply"** (sparkle icon = generate from brief). Disabled until the input is non‑empty.
5. **Hint** — centered `.help`. With examples: *"Drawing on N saved examples of your writing. More in Voice means a closer match."* With an empty library: *"No examples yet — add a few in Voice so drafts sound like you."* (count is live from the shared library; singularizes to "1 example").
6. **Error** (instead of hint, on failure) — see Error states.

### Reply‑context card (`.context-card`) — renders like a tweet
Header row: reply icon + accent eyebrow **"Replying to"** + a clear (×) icon button. Optional **"Earlier in thread"** quoted line (`.ctx-thread-text`, left border). Then a **mini‑tweet**: neutral round avatar (34px) + name row (**name** · `@handle` muted) + tweet text at `--fs-md`, line‑height 1.5. This continuity with X is intentional — don't make it a generic quote box.

### Draft state (once generated) — the focal point
The input **collapses** so the draft dominates.
- **Brief bar** (`.brief`): a type badge (post/reply) + a truncated one‑line summary of the brief (reply shows "to @handle · …") that's a button opening the editor, + a **discard** (trash) icon that resets everything to the empty composer (toast "Started over"). Opening the brief reveals an inline editor (attach/remove reply, textarea, cap toggle, **"↻ Regenerate"** primary + Cancel).
- **Draft card** (`.draft.draft-lg`): accent border + soft accent‑tinted lift. Header: accent eyebrow **"Your draft"**, a **"refined"** badge after any refine, and on the right either a live **char count** (mono, `N / 280` or `N chars`; turns danger when over) **or** an "updating…" indicator with a pulsing dot while (re)generating. Body: draft text at `--fs-lg`, line‑height ~1.66; **crossfades** when it changes (no dim‑flicker). If over the cap: a `.callout.warn` ("Over by N. A tighten pass already ran — trim by hand or regenerate.").
  - **Actions** (`.draft-actions`): **"⧉ Copy to X"** primary (flips to "✓ Copied" ~1.5s), an icon **↻ Regenerate** ("same brief, fresh take"), and an icon **↶ Undo** (one level; disabled when nothing to undo).
- **Refine** (`.refine`): two blocks. Dim + lock (`.is-busy`, pointer‑events none) during any (re)generation — **never removed**, just greyed.
  - **Quick refine** — chips (`.chip`): neutral by default; on click they **flash accent momentarily** then settle (they are repeatable actions, not toggles). Pressing the same chip again increments a **×N counter** on that chip (first press unmarked). Hint: *"Tap to apply. Tap again to push the same direction further."* The clicked chip stays bright through the flash while the others dim.
  - **Steer it** — a 2‑column grid of `More of` / `Less of` textareas (2 rows, 140 char max, mono‑ish). **No auto‑fire** — an explicit **"Apply"** button (with a `⌘↵` hint) commits, also bound to ⌘/Ctrl+Enter in the fields. Help: *"Describe a tweak, then apply."*

### Generate vs. Regenerate (one concept)
"✦ Generate" is the first draft from the brief. After that, **everything is "↻ Regenerate"** with the same refresh icon — the draft's quick re‑roll and the brief editor's confirm are the *same* action (re‑roll on a fixed brief vs. redraft after editing). Don't reintroduce a second differently‑labeled button.

---

## Screen 3 — Voice (`panel-voice.jsx`) — the example library
The corpus of the user's own writing that drafts borrow from. Header: **"Voice"** + *"Examples of your own writing. Drafts borrow this voice — the more here, the closer the match."*

- **Saving from X** (`.capture-banner`): a card with a status dot + title/desc + a **green** `.switch`. Off: title **"Save tweets from X"**, *"Click your own posts on x.com to save them. Only @handle's writing gets in."* On: title **"Saving from X"**, banner + dot turn **green** (pulsing dot) — green = "on". (Real behavior: while on, clicks on the user's own tweets on x.com are captured; author‑filtered by handle.)
- **Section header** (`.lib-header`): eyebrow **"Saved examples"** + *"The writing your drafts learn from. Edit or retype anytime."* + a **+** icon that toggles the manual add form.
- **Add form** (`.card.inset`, when toggled): textarea ("Paste your own post or reply" / placeholder "exactly as you wrote it") + Post/Reply segmented control + an "This is my own writing" confirm switch + **"Save to voice"** primary (disabled until text + confirm). Manual add dedupes against existing text.
- **Filter row**: pills **All N / Posts N / Replies N** + an **"Expand all / Collapse all"** ghost button (respects the active filter).
- **List** (`.lib-list`): each row (`.lib-row`) = a meta line (type badge + source badge, with hover‑revealed **Edit** + **Delete** icon buttons on the right) and the text at `--fs-md` (tweet rhythm). Text is **clamped to 2 lines** with a blue **"Show more / Show less"** link that appears *only* when the text actually overflows (measured). **Edit** swaps the row to an inline editor (textarea + Post/Reply + Save/Cancel; "Changes saved" toast). **Delete** removes with a **"Removed · Undo"** toast that restores to the original index. New items animate in with a **quiet neutral** settle (not green — banners carry the success color).
- **Empty states**: whole library empty → *"Nothing saved yet. Turn on saving above and click your own posts on x.com — or paste one in by hand."* Filtered‑empty (e.g. no replies but posts exist) → *"No replies saved yet — switch to All to see the rest."*

### Save‑result banners (`.save-result`) — prominent, color‑coded, can't‑miss
Shown at the top of Voice when a save is attempted. Icon chip (filled circle, white glyph) + bold title + plain message; a dismiss (×). **Only clean success auto‑dismisses** (with a thin progress bar, ~4.5s); everything else **persists** until dismissed. Six outcomes:
| Outcome | Tone | Title | Message | Saved? |
|---|---|---|---|---|
| success | green (ok) | Saved to your voice | "Added as a **post/reply**." | yes (+ row settles in) |
| text + media | amber (warn) | Saved — text only | "This post had media. We saved the **text**; images and quoted posts aren't read." | yes (text) |
| duplicate | blue (info) | Already in your voice | "You saved this one before — no need to add it twice." + **"Show me"** (flashes the existing row) | no |
| not yours | red (danger) | Not saved | "That post is by **@someone**. Only your own posts (@handle) can join your voice." | no |
| cut‑off | amber (warn) | Not saved — this tweet is cut off | "We only save the full text. Click **'Show more'** on the post to expand it, then save it again." | no |
| media‑only | red (danger) | Not saved — nothing to read | "This post is media only. Margin learns from text, so there's nothing to add to your voice." | no |

---

## Screen 4 — Full‑page options (`options.jsx` + `panel-settings.jsx` + `panel-prompts.jsx`)
Opens as a normal browser tab (gear in the panel). Layout: a **sticky left nav** (210px) + a fluid **main column** (page max‑width 1000px).
- **Left aside**: "← Back to X", brand, nav buttons (Account / Output rules / Prompts / Data — each with its icon), a divider, a **theme toggle** ("Light/Dark theme"), and a foot line *"Margin v1 · honest LLM wrapper · no telemetry."*
- **Main**: a head row with the page **H1** + a one‑line **description** (`.opt-sub`) and a **quiet "✓ Saved" flag** top‑right that fades in on change (`.opt-saved.show`). Below: the section's cards.

**Save model:** Output rules, Prompts, and Data **apply immediately** and flash the "Saved" flag. **Account uses an explicit Save** button (it holds a secret).

### Account (`AccountSection`)
Two cards. **"Your X account"** — handle field with an `@` prefix (`.input-prefixed`); desc *"The hard filter for saving — only posts from this handle can join your voice."* **"Anthropic API key"** — a 2‑col grid (password key field + "Where to keep it" select: Persistent / Session only), then a `.callout.warn` candor note (**"Set a spend cap first."** — key stored unencrypted, OS‑protected, blast radius = API spend, revocable), then **"Save key"** (→ "✓ Saved") + **"Verify"** (→ "✓ Key works").

### Output rules (`RulesSection`) — 2×2 card grid
- **Structural rules** — toggles: No em dashes, No smart/curly quotes, No staccato runs (3+ short sentences).
- **Do‑not‑say banlist** — mono textarea, one entry per line (whole‑word, case‑insensitive).
- **Example sampling** — "Pool size" slider 5–40 (live value).
- **Temperature** — "Generate" and "Regenerate" sliders 0–1 step .05; desc *"Regenerate runs hotter so re‑rolls feel different."*

### Prompts (`panel-prompts.jsx`) — three cards
- **Prompt templates** — a **single‑open accordion** (opening one closes others), grouped Generation / Refine / Repair. Each row header: label + **"edited"** badge (body ≠ default) + **"missing slot"** danger badge (a required slot absent from the body). Open body: the template textarea + a **Slots** row showing each required slot as a chip — **green ✓** if present, **red ⚠** if missing — a missing‑slot warning line, a char count, and a **"Reset to default"** (disabled unless edited).
- **Refine chips** — a real editor: a **Label** + **Instruction** text input per chip, a per‑row **delete**, an **"+ Add chip"**, and a header **"Reset to defaults."** Label shows on the chip in Compose; instruction is what the model is told.
- **Inspect last prompt** — a **"View/Hide"** toggle that expands an inspector: a meta line (model badge + "sent N min ago") and **System / User / Response** blocks in monospace (`.insp-pre`), each with a char count and a **Copy** button. The Response block is accent‑bordered. (Real product: read the session‑stored last prompt.)

### Data (`DataSection`) — two cards
- **Export your voice** — desc + a spec list (Format: JSON · schema v1 / Includes: N examples, type & source / Destination: downloads folder) + **"Export as JSON"** (disabled when empty). 
- **Clear voice library** (`.danger-zone`) — desc with the live count + a **"Clear everything"** danger‑outline button that requires a **two‑step inline confirm** ("Delete all N? This is permanent." → Cancel / "Yes, clear it"). Wired to the shared library so clearing also empties Voice and updates the Compose hint.

---

## Interactions, animations & state
- **Generation/refine timing (prototype mock):** ~850ms to first draft, ~600ms per refine; replace with the real background round‑trip. Latest‑call‑wins; in‑flight refines lock the refine block.
- **Shared library state:** Compose's example count and Data's count/clear read the **same** source as Voice — in the real app this is the IndexedDB corpus surfaced via the messaging layer; both screens must reflect adds/edits/deletes live.
- **Chips:** flash animation `chipflash` ~0.55s; per‑chip press counter resets on a new generation / undo / steer‑apply / discard.
- **Draft text** crossfades via a keyed remount (`draftfade` ~0.28s). Don't reintroduce the old opacity dim.
- **Save banners:** `srin` entrance; success has a `srprog` progress bar. New library rows: `justadded` neutral settle (~1.7s); duplicate flash: `flashdup` (~2.3s).
- **Accessibility (open item):** icon‑only buttons currently rely on `title` only — add proper `aria-label`s when implementing.

### Error states (Compose, `ERRORS` in `panel-compose.jsx`)
Calm, actionable cards: **auth** (danger, key icon, "Check your API key" + "Open settings"), **rate‑limit** (warn, "Rate limited" + "Retry"), **network/server** (warn, "Couldn't reach Anthropic" + "Retry"). The input stays visible so nothing is lost. Map to the real error kinds the background worker already returns (auth / rate‑limit / network / server / bad‑request) plus the over‑280 tighten case.

---

## Character counting
Use the codebase's existing **`twitter-text` weighted length** (URLs always count as 23, some characters as 2) — the prototype's `weighted()` in `data.jsx` is a rough stand‑in. The count tooltip's candor ("X‑weighted — URLs always count as 23, some characters as 2") should stay.

---

## Assets
- **No external images or icon fonts.** All icons are simple inline‑SVG line glyphs in `icons.jsx` (gear, copy, check, reply, mic, sparkle, etc.) — reproduce as an icon set/components. The brand mark is built from plain elements (no SVG). Avatars in the reply card are neutral CSS circles (the real app would show the captured author's avatar if available, else a neutral placeholder).

---

## Files in this bundle
- `Margin — X Post Composer.html` — entry; mounts the prototype (ignore the Chrome‑window frame + timeline; presentation only).
- `styles.css` — **all design tokens + component styles** (the source of truth for visuals).
- `app.jsx` — top‑level: browser frame, docked panel vs. options view, **Tweaks panel (prototype‑only)**, shared library state.
- `panel.jsx` — side‑panel shell (header, nav, toast).
- `panel-compose.jsx` — Compose screen (the core loop, reply‑context card, error cards).
- `panel-voice.jsx` — Voice library (saving, list, inline edit, save‑result banners, demo strip = prototype‑only).
- `panel-prompts.jsx` — Prompts settings (accordion, chip editor, last‑prompt inspector).
- `panel-settings.jsx` — Account / Output rules / Data sections + nav category metadata.
- `options.jsx` — full‑page options shell (left nav, page head, quiet Saved flag).
- `data.jsx` — **mock content only** (library, reply context, drafts, chips, prompt templates, last prompt, banlist). Replace with real storage/messaging.
- `icons.jsx` — inline‑SVG icon set.
- `tweaks-panel.jsx`, `browser-window.jsx` — **prototype scaffolding; do not port.**

## Suggested mapping to the existing codebase
- `panel-compose.jsx` → `src/ui/Composer.tsx` (+ `DraftDisplay.tsx`, `ReplyContextDisplay.tsx`, chips/more‑less)
- `panel-voice.jsx` → `src/ui/VoiceTab.tsx` (+ `LibraryItemRow.tsx`, `AddManuallyForm.tsx`, `CaptureControls.tsx`)
- `panel-prompts.jsx` → `src/ui/tabs/PromptsTab.tsx` (+ `TemplateEditor.tsx`, `ChipManager.tsx`, `LastPromptInspector.tsx`)
- `panel-settings.jsx` → `AccountTab.tsx`, `OutputRulesTab.tsx`, `DataTab.tsx`
- `options.jsx` / `panel.jsx` → the side‑panel + options entrypoints and `Tabs.tsx` (note: nav is now Compose/Voice with settings on the full options page, not flat tabs)
- `styles.css` tokens → your styling layer (CSS variables / theme), preserving light + dark.
