import { useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { CountRing } from './CountRing';
import { SeedLine } from './SeedLine';
import { monogram } from './monogram';
import { ViolationNote } from './ViolationNote';
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
  /** Scoped refines (threads): the post chips/steering aim at. */
  scope: number | null;
  onAimPost: (postIndex: number) => void;
  onClearScope: () => void;
}

interface DraftStateProps {
  reply: ReplyContextControls;
  brief: BriefControls;
  draft: DraftView;
  refine: RefineControls;
  /** Drives the NEXT generation's seed; rendered as the expanded
   *  brief's "Sounding like …" line. */
  bundlePicker: BundlePickerControls;
  /** Counts for the seed menu's honest subtitles. */
  libraryCount: number;
  guaranteedStars: number;
  /** The user's @handle — the draft renders as their tweet. */
  handle: string;
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
  /** Scoped fresh take on one thread card. */
  onRewritePost: (postIndex: number) => void;
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
  /** The post-ship exit — clears the bench once committed (timed undo). */
  onDone: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

/**
 * The on-copy consequence sentence: what copying will do (or, once
 * committed, what it did) — the two switches live behind "change".
 */
function copySentence(
  committed: boolean,
  shipToVoice: boolean,
  filesInto: string | null,
  threadCount: number | null,
): ReactNode {
  if (committed) {
    if (!shipToVoice) return <>Not saved to Voice (switched off for this draft) — done.</>;
    return (
      <>
        Saved to Voice
        {filesInto ? (
          <>
            {' '}
            and filed into <b>“{filesInto}”</b>
          </>
        ) : null}{' '}
        — done. Next draft clears the bench (Undo for a few seconds).
      </>
    );
  }
  if (!shipToVoice) return <>Copying won’t save this draft to Voice</>;
  return (
    <>
      {threadCount !== null ? <>Copying all {threadCount} saves the thread</> : <>Copying saves</>}{' '}
      to Voice
      {filesInto ? (
        <>
          {' '}
          and files into <b>“{filesInto}”</b>
        </>
      ) : null}
    </>
  );
}

/** Draft state — the draft IS a tweet; everything else stays quiet. */
export function DraftState({
  reply,
  brief,
  draft,
  refine,
  bundlePicker,
  libraryCount,
  guaranteedStars,
  handle,
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
  onRewritePost,
  shipToVoice,
  onToggleShipToVoice,
  onRegenerate,
  onPolish,
  onUndo,
  onCopy,
  onCopyPost,
  onDone,
  onDiscard,
  onRetry,
  onOpenOptions,
}: DraftStateProps) {
  const hasContext = reply.replyContext !== null;
  const isThread = draft.kind === 'thread';
  const first = draft.posts[0];
  const copiedCount = draft.posts.filter((p) => p.copied).length;
  const nextUncopied = draft.posts.findIndex((p) => !p.copied);
  // Peek at the tweet being replied to: the draft dominates the canvas,
  // but the full context card stays one click away.
  const [contextOpen, setContextOpen] = useState<boolean>(false);
  // The on-copy switches, folded behind the sentence's "change" link.
  const [changeOpen, setChangeOpen] = useState<boolean>(false);
  const peekTitle = contextOpen
    ? "Hide the tweet you're replying to"
    : "Show the tweet you're replying to";

  const ringLimit = brief.charCap ? X_HARD_LIMIT : brief.softCapChars;
  const filesInto = shipToVoice !== null && fileToBundle ? seedBundleName : null;

  return (
    <>
      {/* BRIEF — one quiet hairline row; opens in place */}
      {!expanded ? (
        <>
          <div className="briefbar">
            {hasContext && (
              <button
                type="button"
                className="bb-to"
                title={peekTitle}
                aria-expanded={contextOpen}
                onClick={() => setContextOpen((v) => !v)}
              >
                @{reply.replyContext?.targetAuthorHandle ?? '—'}
              </button>
            )}
            <button
              type="button"
              className="bb-main"
              onClick={() => setExpanded(true)}
              title="Edit your brief"
            >
              <span className="bb-text">
                <b>{briefText}</b>
              </span>
              <IcEdit className="bb-edit" />
            </button>
            <button
              type="button"
              className="icon-btn bb-trash"
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
        <div className="editbrief">
          {hasContext && reply.replyContext ? (
            contextOpen ? (
              <ReplyContextCard
                context={reply.replyContext}
                onClear={reply.onClearReplyContext}
                onCollapse={() => setContextOpen(false)}
              />
            ) : (
              <div className="eb-ctx">
                <button
                  type="button"
                  className="eb-ctx-toggle"
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
          <textarea
            className="eb-input"
            rows={3}
            value={brief.bullets}
            onKeyDown={brief.onGenKey}
            onChange={(e) => brief.setBullets(e.target.value)}
            placeholder={hasContext ? "What's your angle?" : 'What do you want to say?'}
          />
          <SeedLine picker={bundlePicker} libraryCount={libraryCount} starCount={guaranteedStars} />
          {threadControls && <ModeControls controls={threadControls} />}
          <div className="eb-row">
            <CapToggle charCap={brief.charCap} setCharCap={brief.setCharCap} />
            {!brief.charCap && <span className="hint">soft cap {brief.softCapChars}</span>}
            <span className="head-spacer" />
            <button type="button" className="btn ghost" onClick={() => setExpanded(false)}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={onRegenerate}>
              <IcRefresh /> Regenerate
            </button>
          </div>
        </div>
      )}

      {error && <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />}

      {/* THE DRAFT, rendered as a tweet */}
      <div className={`draftwrap ${expanded ? 'is-behind' : ''}`}>
        {!isThread && <span className="avatar av-40">{monogram(handle)}</span>}
        <div className="draft-body">
          {busy && draft.posts.length === 0 ? (
            <>
              <div className="tw-head">
                <span className="tw-meta">@{handle || '—'} · drafting</span>
              </div>
              <div className="drafting">
                <div className="shim" style={{ width: '92%' }} />
                <div className="shim" style={{ width: '100%' }} />
                <div className="shim" style={{ width: '64%' }} />
              </div>
              <p className="drafting-line">
                <span className="pulse-dot" /> Drafting in your voice…
              </p>
            </>
          ) : isThread ? (
            <>
              <div className="threadbar">
                <span className="tb-title">Thread</span>
                {threadControls && <ModeControls controls={threadControls} compact />}
                <span className="head-spacer" />
                <span className="count" title="Posts copied so far — copying every post commits">
                  {copiedCount}/{draft.posts.length} copied
                </span>
              </div>
              <ThreadCards
                posts={draft.posts}
                charCap={brief.charCap}
                softCapChars={brief.softCapChars}
                busy={busy}
                handle={handle}
                aimedPost={refine.scope}
                onEditPost={onEditPost}
                onCopyPost={onCopyPost}
                onRewritePost={onRewritePost}
                onAimPost={refine.onAimPost}
              />
            </>
          ) : (
            <>
              <div className="tw-head">
                <span className="tw-meta">@{handle || '—'} · draft</span>
                <span className="head-spacer" />
                <span className="draft-tags">
                  {draft.committed && !busy ? (
                    <span
                      className="ok-tag"
                      title="Copied to X — edits after this re-open the draft"
                    >
                      ✓ copied
                    </span>
                  ) : (
                    <>
                      {draft.refined && !busy && 'refined'}
                      {draft.refined && draft.handEdited && !busy && ' · '}
                      {draft.handEdited && !busy && 'edited'}
                    </>
                  )}
                  {busy && (
                    <span className="upd">
                      <span className="pulse-dot" /> updating…
                    </span>
                  )}
                </span>
              </div>
              <DraftEditor
                text={first?.text ?? ''}
                violations={first?.residualViolations ?? []}
                disabled={busy}
                onEdit={(text) => onEditPost(0, text)}
              />
              <div className="draft-foot">
                <CountRing
                  count={first?.count ?? 0}
                  limit={ringLimit}
                  over={first?.over ?? false}
                  committed={draft.committed && !busy}
                />
                <span className={`count ${(first?.over ?? false) ? 'over' : ''}`}>
                  {first?.count ?? 0}
                  {brief.charCap ? ` / ${String(X_HARD_LIMIT)}` : ' chars'}
                </span>
              </div>
              {(first?.over ?? false) && (
                <div className="callout warn">
                  <IcWarn />
                  <span>
                    <strong>Over by {(first?.count ?? 0) - X_HARD_LIMIT}.</strong> A tighten pass
                    already ran — trim by hand or regenerate.
                  </span>
                </div>
              )}
              {(first?.residualViolations.length ?? 0) > 0 && (
                <ViolationNote violations={first?.residualViolations ?? []} />
              )}
            </>
          )}
        </div>
      </div>

      {/* ACTIONS — pill + round ghost icons; kbd hints in tooltips */}
      <div className="draft-actions">
        {draft.committed && !busy ? (
          <>
            <button
              type="button"
              className="btn dark lg done-btn"
              onClick={onDone}
              title="Wrap up — clear the bench for the next one (Undo for a few seconds)"
            >
              <IcCheck className="done-check" /> Done — next draft
            </button>
            <span className="head-spacer" />
            {!isThread && (
              <button
                type="button"
                className="icon-btn"
                onClick={onCopy}
                title="Copy again"
                aria-label="Copy again"
              >
                <IcCopy />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Regenerate — same brief, fresh take"
              aria-label="Regenerate"
              onClick={onRegenerate}
            >
              <IcRefresh />
            </button>
          </>
        ) : (
          <>
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
                    Copy {nextUncopied + 1} of {draft.posts.length}
                  </>
                )
              ) : draft.copied ? (
                <>
                  <IcCheck /> Copied
                </>
              ) : (
                <>Copy to X</>
              )}
            </button>
            <span className="head-spacer" />
            <button
              type="button"
              className="icon-btn"
              title="Polish — one tightening pass, voice and meaning preserved"
              aria-label="Polish the draft"
              onClick={onPolish}
              disabled={busy}
            >
              <IcSparkle />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Regenerate — same brief, fresh take"
              aria-label="Regenerate"
              onClick={onRegenerate}
              disabled={busy}
            >
              <IcRefresh />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Undo last change"
              aria-label="Undo"
              disabled={!draft.canUndo || busy}
              onClick={onUndo}
            >
              <IcUndo />
            </button>
          </>
        )}
      </div>

      {/* The on-copy consequence sentence; switches behind "change". */}
      {shipToVoice !== null && (
        <div className="copyline">
          <p className="hint">
            {copySentence(
              draft.committed && !busy,
              shipToVoice,
              filesInto,
              isThread ? draft.posts.length : null,
            )}
            {!(draft.committed && !busy) && (
              <>
                {' · '}
                <button
                  type="button"
                  className="textlink"
                  aria-expanded={changeOpen}
                  onClick={() => setChangeOpen((v) => !v)}
                >
                  change
                </button>
              </>
            )}
          </p>
          {changeOpen && !(draft.committed && !busy) && (
            <div className="copy-effects">
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
        </div>
      )}

      {/* REFINE — chips + steer, no eyebrows; dims once committed */}
      <div
        className={`refine ${busy ? 'is-busy' : ''} ${draft.committed && !busy ? 'is-done' : ''}`}
        aria-disabled={busy}
      >
        {refine.scope !== null && (
          <div className="refine-scope" role="status">
            Refining post {refine.scope + 1} only
            <button
              type="button"
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title="Back to refining the whole thread"
              aria-label="Clear the aim"
              onClick={refine.onClearScope}
            >
              <IcX />
            </button>
          </div>
        )}
        {refine.chips.length > 0 && (
          <div className="chiprow">
            {refine.chips.map((c) => {
              const n = refine.chipCounts[c.id] ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${refine.flash === c.id ? 'flash' : ''}`}
                  title={`${c.instruction} — tap again to push further`}
                  disabled={busy}
                  onClick={() => refine.onApplyChip(c)}
                >
                  {c.label}
                  {n >= 2 && <span className="chip-x">×{n}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="steer">
          <textarea
            rows={2}
            maxLength={FREEFORM_MAX}
            value={refine.steerText}
            disabled={busy}
            onKeyDown={refine.onSteerKey}
            onChange={(e) => refine.setSteerText(e.target.value)}
            placeholder="Tell it what to change — lead with the joke, cut the hedge…"
          />
          <div className="steer-row">
            <span className="hint">⌘↵</span>
            <button
              type="button"
              className="btn primary sm"
              disabled={!refine.canApplySteer}
              onClick={refine.onApplySteer}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <LastPromptInspector />
    </>
  );
}
