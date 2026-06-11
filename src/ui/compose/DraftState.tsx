import type { KeyboardEvent } from 'react';
import type { ChipPreset } from '../../types';
import type { Span } from '../../lib/exclusion';
import { X_HARD_LIMIT } from '../../lib/counting';
import { DraftEditor } from './DraftEditor';
import { LastPromptInspector } from '../LastPromptInspector';
import {
  IcCheck,
  IcCopy,
  IcEdit,
  IcLess,
  IcMore,
  IcRefresh,
  IcReply,
  IcTrash,
  IcUndo,
  IcWarn,
  IcX,
} from '../icons';
import { CapToggle } from './CapToggle';
import { ErrorCard, type ErrorKind } from './ErrorCard';
import { ReplyContextBanner } from './ReplyContextBanner';
import type { BriefControls, ReplyContextControls } from './types';

const MORELESS_MAX = 140;

/** What the draft card needs to render the current result. */
export interface DraftView {
  text: string;
  residualViolations: Span[];
  refined: boolean;
  /** The user typed in the draft — their text is ground truth now. */
  handEdited: boolean;
  /** Lifecycle phase is `committed` (copied, no edits since). */
  committed: boolean;
  count: number;
  over: boolean;
  copied: boolean;
  canUndo: boolean;
}

/** Chip + more/less steering controls under the draft. */
export interface RefineControls {
  chips: ChipPreset[];
  chipCounts: Record<string, number>;
  flash: string | null;
  moreText: string;
  setMoreText: (v: string) => void;
  lessText: string;
  setLessText: (v: string) => void;
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
  briefText: string;
  busy: boolean;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  error: ErrorKind | null;
  onEditDraft: (text: string) => void;
  onRegenerate: () => void;
  onUndo: () => void;
  onCopy: () => void;
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
  briefText,
  busy,
  expanded,
  setExpanded,
  error,
  onEditDraft,
  onRegenerate,
  onUndo,
  onCopy,
  onDiscard,
  onRetry,
  onOpenOptions,
}: DraftStateProps) {
  const hasContext = reply.replyContext !== null;
  const mode: 'post' | 'reply' = hasContext ? 'reply' : 'post';
  return (
    <>
      {!expanded ? (
        <div className="brief">
          <span className={`badge ${mode}`}>{mode}</span>
          <button
            type="button"
            className="brief-main"
            onClick={() => setExpanded(true)}
            title="Edit your brief"
          >
            <span className="brief-text">
              {mode === 'reply' && reply.replyContext?.targetAuthorHandle
                ? `to @${reply.replyContext.targetAuthorHandle} · ${briefText}`
                : briefText}
            </span>
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
      ) : (
        <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {hasContext && reply.replyContext ? (
            <div className="brief-ctx">
              <IcReply />
              Replying to @{reply.replyContext.targetAuthorHandle ?? '—'}
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
          ) : (
            <ReplyContextBanner
              compact
              on={reply.captureModeIsReplyContext}
              onToggle={reply.onToggleReplyContextMode}
            />
          )}
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

      {error && <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />}

      {/* DRAFT CARD — focal point */}
      <div className="draft">
        <div className="draft-head">
          <span className="eyebrow">Your draft</span>
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
                : 'Uncapped — click to enforce ≤280'
            }
            onClick={() => brief.setCharCap(!brief.charCap)}
          >
            ≤280
          </button>
          {busy && draft.text !== '' ? (
            <span className="upd">
              <span className="upd-dot" />
              updating…
            </span>
          ) : (
            <span
              className={`count ${draft.over ? 'over' : ''}`}
              title="X-weighted count — URLs always count as 23, some characters as 2"
            >
              {draft.count}
              {brief.charCap ? ` / ${X_HARD_LIMIT}` : ' chars'}
            </span>
          )}
        </div>
        {busy && draft.text === '' ? (
          <div className="drafting">
            <div className="shim" style={{ width: '92%' }} />
            <div className="shim" style={{ width: '100%' }} />
            <div className="shim" style={{ width: '64%' }} />
          </div>
        ) : (
          <>
            <div className="draft-body">
              <DraftEditor
                text={draft.text}
                violations={draft.residualViolations}
                disabled={busy}
                onEdit={onEditDraft}
              />
            </div>
            {draft.over && (
              <div className="draft-warn">
                <div className="callout warn">
                  <IcWarn />
                  <span>
                    Over by {draft.count - X_HARD_LIMIT}. A tighten pass already ran — trim by hand
                    or regenerate.
                  </span>
                </div>
              </div>
            )}
            <div className="draft-actions">
              <button
                type="button"
                className="btn primary lg"
                onClick={onCopy}
                disabled={busy}
                title="Copy the draft — ⇧⌘↵ (Ctrl+Shift+Enter)"
              >
                {draft.copied ? (
                  <>
                    <IcCheck /> Copied
                  </>
                ) : (
                  <>
                    <IcCopy /> Copy to X <span className="kbd kbd-on">⇧⌘↵</span>
                  </>
                )}
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
          <div className="moreless-grid">
            <div className="ml-cell">
              <span className="ml-label">
                <IcMore /> More of
              </span>
              <textarea
                rows={2}
                maxLength={MORELESS_MAX}
                value={refine.moreText}
                disabled={busy}
                onKeyDown={refine.onSteerKey}
                onChange={(e) => refine.setMoreText(e.target.value)}
                placeholder="the dry humor, concrete detail…"
              />
            </div>
            <div className="ml-cell">
              <span className="ml-label">
                <IcLess /> Less of
              </span>
              <textarea
                rows={2}
                maxLength={MORELESS_MAX}
                value={refine.lessText}
                disabled={busy}
                onKeyDown={refine.onSteerKey}
                onChange={(e) => refine.setLessText(e.target.value)}
                placeholder="hedging, jargon, hype…"
              />
            </div>
          </div>
          <div className="steer-apply">
            <span className="help">Describe a tweak, then apply.</span>
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
