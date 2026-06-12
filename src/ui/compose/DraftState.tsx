import { useState, type KeyboardEvent } from 'react';
import type { ChipPreset } from '../../types';
import { X_HARD_LIMIT } from '../../lib/counting';
import { DraftEditor } from './DraftEditor';
import { ModeControls } from './ModeControls';
import { ThreadCards, type DraftPostViewModel } from './ThreadCards';
import { LastPromptInspector } from '../LastPromptInspector';
import {
  IcCheck,
  IcChevR,
  IcCopy,
  IcEdit,
  IcRefresh,
  IcSparkle,
  IcReply,
  IcTrash,
  IcUndo,
  IcWarn,
  IcX,
} from '../icons';
import { BundlePicker } from './BundlePicker';
import { CapToggle } from './CapToggle';
import { ErrorCard, type ErrorKind } from './ErrorCard';
import { ReplyContextBanner } from './ReplyContextBanner';
import { ReplyContextCard } from './ReplyContextCard';
import type {
  BriefControls,
  BundlePickerControls,
  ReplyContextControls,
  ThreadModeControls,
} from './types';

const FREEFORM_MAX = 280;

/** What the draft card needs to render the current result. */
export interface DraftView {
  /** Single card vs thread cards. */
  kind: 'single' | 'thread';
  /** Per-post views: length 1 for singles, the segments otherwise.
   *  Empty only while the FIRST generation is in flight (shimmer). */
  posts: DraftPostViewModel[];
  refined: boolean;
  /** The user typed in the draft — their text is ground truth now. */
  handEdited: boolean;
  /** Lifecycle phase is `committed` (every post copied, no edits since). */
  committed: boolean;
  /** The single big button's transient flash (singles only). */
  copied: boolean;
  canUndo: boolean;
}

/** Chip + freeform-feedback controls under the draft. */
export interface RefineControls {
  chips: ChipPreset[];
  chipCounts: Record<string, number>;
  flash: string | null;
  steerText: string;
  setSteerText: (v: string) => void;
  canApplySteer: boolean;
  onSteerKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onApplyChip: (c: ChipPreset) => void;
  onApplySteer: () => void;
}

interface DraftStateProps {
  reply: ReplyContextControls;
  brief: BriefControls;
  draft: DraftView;
  refine: RefineControls;
  /** Null when no bundles exist. Shown in the expanded brief so a
   *  regenerate can switch or drop the seed. */
  bundlePicker: BundlePickerControls | null;
  /** Name of the bundle that seeded the CURRENT draft (its content's
   *  seedBundleId resolved by ComposeScreen), or null when sampled.
   *  Distinct from the picker, which drives the NEXT generation. */
  seedBundleName: string | null;
  /** Per-draft auto-filing override (default on). Only rendered while
   *  the draft is seeded AND the shipped save will happen — borrowing
   *  a bundle's voice for a one-off shouldn't grow the series. */
  fileToBundle: boolean;
  onToggleFileToBundle: () => void;
  /** Null while a reply context exists (threads are posts-only v1). */
  threadControls: ThreadModeControls | null;
  briefText: string;
  busy: boolean;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  error: ErrorKind | null;
  onEditPost: (postIndex: number, text: string) => void;
  /** Per-draft corpus-loop override. Null = the global setting is off,
   *  so the control hides entirely (nothing to override). */
  shipToVoice: boolean | null;
  onToggleShipToVoice: () => void;
  onRegenerate: () => void;
  onPolish: () => void;
  onUndo: () => void;
  /** Copies the single draft, or the first uncopied post of a thread. */
  onCopy: () => void;
  /** Per-card copy (thread cards). */
  onCopyPost: (postIndex: number) => void;
  onDiscard: () => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

/** Draft state — input collapses to a brief; the draft is the focal point. */
export function DraftState({
  reply,
  brief,
  draft,
  refine,
  bundlePicker,
  seedBundleName,
  fileToBundle,
  onToggleFileToBundle,
  briefText,
  busy,
  threadControls,
  expanded,
  setExpanded,
  error,
  onEditPost,
  shipToVoice,
  onToggleShipToVoice,
  onRegenerate,
  onPolish,
  onUndo,
  onCopy,
  onCopyPost,
  onDiscard,
  onRetry,
  onOpenOptions,
}: DraftStateProps) {
  const hasContext = reply.replyContext !== null;
  const mode: 'post' | 'reply' = hasContext ? 'reply' : 'post';
  const isThread = draft.kind === 'thread';
  const badgeText = isThread ? 'thread' : mode;
  const first = draft.posts[0];
  const copiedCount = draft.posts.filter((p) => p.copied).length;
  const nextUncopied = draft.posts.findIndex((p) => !p.copied);
  // Peek at the tweet being replied to: the draft dominates the canvas,
  // but the full context card (exactly as it looked pre-draft) is one
  // click away — from the collapsed bar's "to @handle" or the expanded
  // card's "Replying to" row.
  const [contextOpen, setContextOpen] = useState<boolean>(false);
  const peekTitle = contextOpen
    ? "Hide the tweet you're replying to"
    : "Show the tweet you're replying to";
  return (
    <>
      {!expanded ? (
        <>
          <div className="brief">
            {/* One chip, not two: in reply mode the mode IS "reply to
                @handle", and the whole chip is the context peek. While
                the peek is open, the chip yields — the card directly
                below IS the expanded version of it (one header, two
                sizes, never both). */}
            {hasContext && !contextOpen ? (
              <button
                type="button"
                className="brief-peek"
                title={peekTitle}
                aria-expanded={false}
                onClick={() => setContextOpen(true)}
              >
                reply to @{reply.replyContext?.targetAuthorHandle ?? '—'}
              </button>
            ) : !hasContext ? (
              <span className={`badge ${isThread ? 'reply' : mode}`}>{badgeText}</span>
            ) : null}
            <button
              type="button"
              className="brief-main"
              onClick={() => setExpanded(true)}
              title="Edit your brief"
            >
              <span className="brief-text">{briefText}</span>
              <IcEdit className="brief-edit" />
            </button>
            <button
              type="button"
              className="icon-btn brief-discard"
              title="Discard and start over"
              aria-label="Discard and start over"
              onClick={onDiscard}
            >
              <IcTrash />
            </button>
          </div>
          {contextOpen && reply.replyContext && (
            <ReplyContextCard
              context={reply.replyContext}
              onClear={reply.onClearReplyContext}
              onCollapse={() => setContextOpen(false)}
            />
          )}
        </>
      ) : (
        <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {hasContext && reply.replyContext ? (
            // The compact row and the full card are the SAME header in
            // two sizes: opening replaces one with the other.
            contextOpen ? (
              <ReplyContextCard
                context={reply.replyContext}
                onClear={reply.onClearReplyContext}
                onCollapse={() => setContextOpen(false)}
              />
            ) : (
              <div className="brief-ctx">
                <button
                  type="button"
                  className="brief-ctx-toggle"
                  title={peekTitle}
                  aria-expanded={false}
                  onClick={() => setContextOpen(true)}
                >
                  <IcReply />
                  Replying to @{reply.replyContext.targetAuthorHandle ?? '—'}
                  <IcChevR className="ctx-chev" />
                </button>
                <span className="head-spacer" />
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  title="Remove reply context"
                  aria-label="Remove reply context"
                  onClick={reply.onClearReplyContext}
                >
                  <IcX />
                </button>
              </div>
            )
          ) : (
            <ReplyContextBanner
              compact
              on={reply.captureModeIsReplyContext}
              onToggle={reply.onToggleReplyContextMode}
            />
          )}
          {/* Same grounding cluster as PreDraftState: the seed sits
              with the context, above the angle. */}
          {bundlePicker && <BundlePicker picker={bundlePicker} />}
          <label className="fld">
            <span className="fld-label">
              {hasContext ? 'Your angle' : 'What do you want to say?'}
            </span>
            <textarea
              rows={3}
              value={brief.bullets}
              onKeyDown={brief.onGenKey}
              onChange={(e) => brief.setBullets(e.target.value)}
            />
          </label>
          <CapToggle charCap={brief.charCap} setCharCap={brief.setCharCap} />
          {threadControls && <ModeControls controls={threadControls} />}
          <div className="pillrow">
            <button type="button" className="btn primary" onClick={onRegenerate}>
              <IcRefresh /> Regenerate
            </button>
            <button type="button" className="btn ghost" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pure provenance — the compose UI states plainly when a bundle
          drove the current draft's examples. What copying DOES with it
          lives in the "On copy" row below, beside its sibling switch. */}
      {seedBundleName && (
        <p className="help bundle-note">Voice examples from bundle “{seedBundleName}”.</p>
      )}

      {error && <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />}

      {/* DRAFT CARD — focal point */}
      <div className="draft">
        <div className="draft-head">
          <span className="eyebrow">{isThread ? 'Your thread' : 'Your draft'}</span>
          {draft.refined && !busy && <span className="badge reply">refined</span>}
          {draft.handEdited && !busy && (
            <span className="badge" title="You've edited this draft — your text is kept as-is">
              edited
            </span>
          )}
          {draft.committed && !busy && (
            <span className="badge ok" title="Copied to X — edits after this re-open the draft">
              copied
            </span>
          )}
          <span className="head-spacer" />
          <button
            type="button"
            className={`minitoggle ${brief.charCap ? 'on' : 'off'}`}
            title={
              brief.charCap
                ? '≤280 cap is ON — click to switch to uncapped'
                : draft.posts.some((p) => p.over || p.count > X_HARD_LIMIT)
                  ? 'Uncapped — click to REFIT this draft to ≤280 (content preserved, never regenerated)'
                  : 'Uncapped — click to enforce ≤280'
            }
            onClick={() => brief.setCharCap(!brief.charCap)}
          >
            ≤280
          </button>
          {busy && draft.posts.length > 0 ? (
            <span className="upd">
              <span className="upd-dot" />
              updating…
            </span>
          ) : isThread ? (
            <span className="count" title="Posts copied so far — copying every post commits">
              {copiedCount}/{draft.posts.length} copied
            </span>
          ) : (
            <span
              className={`count ${(first?.over ?? false) ? 'over' : ''}`}
              title="X-weighted count — URLs always count as 23, some characters as 2"
            >
              {first?.count ?? 0}
              {brief.charCap ? ` / ${X_HARD_LIMIT}` : ' chars'}
            </span>
          )}
        </div>
        {busy && draft.posts.length === 0 ? (
          <div className="drafting">
            <div className="shim" style={{ width: '92%' }} />
            <div className="shim" style={{ width: '100%' }} />
            <div className="shim" style={{ width: '64%' }} />
          </div>
        ) : (
          <>
            {isThread ? (
              <div className="draft-body">
                <ThreadCards
                  posts={draft.posts}
                  charCap={brief.charCap}
                  busy={busy}
                  onEditPost={onEditPost}
                  onCopyPost={onCopyPost}
                />
              </div>
            ) : (
              <div className="draft-body">
                <DraftEditor
                  text={first?.text ?? ''}
                  violations={first?.residualViolations ?? []}
                  disabled={busy}
                  onEdit={(text) => onEditPost(0, text)}
                />
              </div>
            )}
            {!isThread && (first?.over ?? false) && (
              <div className="draft-warn">
                <div className="callout warn">
                  <IcWarn />
                  <span>
                    Over by {(first?.count ?? 0) - X_HARD_LIMIT}. A tighten pass already ran — trim
                    by hand or regenerate.
                  </span>
                </div>
              </div>
            )}
            <div className="draft-actions">
              <button
                type="button"
                className="btn primary lg"
                onClick={onCopy}
                disabled={busy || (isThread && nextUncopied === -1)}
                title={
                  isThread
                    ? 'Copy the next post — Ctrl+Shift+Enter while the panel is focused'
                    : 'Copy the draft — Ctrl+Shift+Enter while the panel is focused'
                }
              >
                {isThread ? (
                  nextUncopied === -1 ? (
                    <>
                      <IcCheck /> All copied
                    </>
                  ) : (
                    <>
                      <IcCopy /> Copy {nextUncopied + 1}/{draft.posts.length}{' '}
                      <span className="kbd kbd-on">⌃⇧↵</span>
                    </>
                  )
                ) : draft.copied ? (
                  <>
                    <IcCheck /> Copied
                  </>
                ) : (
                  <>
                    <IcCopy /> Copy to X <span className="kbd kbd-on">⌃⇧↵</span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn lg"
                title="Polish — one tightening pass, voice and meaning preserved"
                aria-label="Polish the draft"
                onClick={onPolish}
                disabled={busy}
              >
                <IcSparkle />
              </button>
              <button
                type="button"
                className="btn lg"
                title="Regenerate — same brief, fresh take"
                aria-label="Regenerate"
                onClick={onRegenerate}
                disabled={busy}
              >
                <IcRefresh />
              </button>
              <button
                type="button"
                className="btn lg"
                title="Undo last change"
                aria-label="Undo"
                disabled={!draft.canUndo || busy}
                onClick={onUndo}
              >
                <IcUndo />
              </button>
            </div>
            {/* Copy's side effects, stated in one place. The bundle
                switch depends on the voice switch (no save → nothing
                to file) — shown disabled, not hidden, so the
                dependency is visible. */}
            {shipToVoice !== null && (
              <div className="copy-effects">
                <span className="ce-label">On copy</span>
                <label
                  className="voice-toggle"
                  title={
                    shipToVoice
                      ? "Copying saves this draft to Voice as a 'shipped' example — click to keep this one out"
                      : "This draft won't be saved to Voice on copy — click to include it"
                  }
                >
                  <span className="switch sm">
                    <input type="checkbox" checked={shipToVoice} onChange={onToggleShipToVoice} />
                    <span className="track" />
                  </span>
                  <span>save to Voice</span>
                </label>
                {seedBundleName && (
                  <label
                    className={`voice-toggle ${!shipToVoice ? 'dep-off' : ''}`}
                    title={
                      !shipToVoice
                        ? 'Saving to Voice is off for this draft — nothing to file into the bundle'
                        : fileToBundle
                          ? 'The shipped example also joins the bundle — click to keep this one out'
                          : 'This draft won’t be filed into the bundle — click to include it'
                    }
                  >
                    <span className="switch sm">
                      <input
                        type="checkbox"
                        checked={shipToVoice && fileToBundle}
                        disabled={!shipToVoice}
                        onChange={onToggleFileToBundle}
                      />
                      <span className="track" />
                    </span>
                    <span className="ce-name">file into “{seedBundleName}”</span>
                  </label>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* REFINE — chips + steer */}
      <div className={`refine ${busy ? 'is-busy' : ''}`} aria-disabled={busy}>
        {refine.chips.length > 0 && (
          <div className="refine-block">
            <span className="eyebrow">Quick refine</span>
            <div className="pillrow">
              {refine.chips.map((c) => {
                const n = refine.chipCounts[c.id] ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${refine.flash === c.id ? 'flash' : ''}`}
                    title={c.instruction}
                    disabled={busy}
                    onClick={() => refine.onApplyChip(c)}
                  >
                    {c.label}
                    {n >= 2 && <span className="chip-x">×{n}</span>}
                  </button>
                );
              })}
            </div>
            <p className="help">Tap to apply. Tap again to push the same direction further.</p>
          </div>
        )}
        <div className="refine-block">
          <span className="eyebrow">Steer it</span>
          <textarea
            rows={2}
            maxLength={FREEFORM_MAX}
            value={refine.steerText}
            disabled={busy}
            onKeyDown={refine.onSteerKey}
            onChange={(e) => refine.setSteerText(e.target.value)}
            placeholder="tell it what to change — lead with the joke, cut the hedge, more of the dry humor…"
          />
          <div className="steer-apply">
            <span className="help">Type feedback in your own words, then apply.</span>
            <button
              type="button"
              className="btn primary sm"
              disabled={!refine.canApplySteer}
              onClick={refine.onApplySteer}
            >
              Apply <span className="kbd kbd-on">⌘↵</span>
            </button>
          </div>
        </div>
      </div>

      <LastPromptInspector />
    </>
  );
}
