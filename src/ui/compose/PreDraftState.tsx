import { CapToggle } from './CapToggle';
import { ErrorCard, type ErrorKind } from './ErrorCard';
import { ModeControls } from './ModeControls';
import { ReplyContextBanner } from './ReplyContextBanner';
import { ReplyContextCard } from './ReplyContextCard';
import { SeedLine } from './SeedLine';
import { monogram } from './monogram';
import type {
  BriefControls,
  BundlePickerControls,
  ReplyContextControls,
  ThreadModeControls,
} from './types';

interface PreDraftProps {
  reply: ReplyContextControls;
  brief: BriefControls;
  bundlePicker: BundlePickerControls;
  /** Null while a reply context exists (threads are posts-only v1). */
  threadControls: ThreadModeControls | null;
  busy: boolean;
  libraryCount: number;
  guaranteedStars: number;
  /** The user's @handle — the composer renders as their reply box. */
  handle: string;
  error: ErrorKind | null;
  onGenerate: () => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

/**
 * Pre-draft state — X's reply-composer anatomy: the context tweet on
 * the rail, connector down to the user's avatar, and the borderless
 * 18px input as the screen's largest element.
 */
export function PreDraftState({
  reply,
  brief,
  bundlePicker,
  threadControls,
  busy,
  libraryCount,
  guaranteedStars,
  handle,
  error,
  onGenerate,
  onRetry,
  onOpenOptions,
}: PreDraftProps) {
  const hasContext = reply.replyContext !== null;
  const canGenerate = brief.bullets.trim() !== '' && !busy;
  const seedBundle = bundlePicker.bundles.find((b) => b.id === bundlePicker.selectedId) ?? null;
  const draftLabel = hasContext
    ? 'Draft reply'
    : threadControls?.composeMode === 'thread'
      ? 'Draft thread'
      : 'Draft post';
  return (
    <>
      {reply.replyContext !== null ? (
        <ReplyContextCard
          context={reply.replyContext}
          onClear={reply.onClearReplyContext}
          connectsDown
        />
      ) : (
        <ReplyContextBanner
          on={reply.captureModeIsReplyContext}
          onToggle={reply.onToggleReplyContextMode}
        />
      )}

      {/* The input is the star: your avatar + big borderless field. */}
      <div className="composer">
        <span className="avatar av-40">{monogram(handle)}</span>
        <textarea
          value={brief.bullets}
          onKeyDown={brief.onGenKey}
          onChange={(e) => brief.setBullets(e.target.value)}
          placeholder={hasContext ? "What's your angle?" : 'What do you want to say?'}
          aria-label={hasContext ? 'Your angle' : 'What do you want to say?'}
        />
      </div>

      <SeedLine picker={bundlePicker} libraryCount={libraryCount} starCount={guaranteedStars} />

      {threadControls && <ModeControls controls={threadControls} />}

      <div className="toolbar">
        <CapToggle charCap={brief.charCap} setCharCap={brief.setCharCap} />
        {!brief.charCap && <span className="hint">soft cap {brief.softCapChars}</span>}
        <span className="row-actions">
          <span className="hint">⌘↵</span>
          <button
            type="button"
            className="btn primary"
            disabled={!canGenerate}
            onClick={onGenerate}
            title="⌘↵ to generate"
          >
            {busy ? 'Drafting…' : draftLabel}
          </button>
        </span>
      </div>

      {error ? (
        <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />
      ) : seedBundle ? (
        <p className="help foot-note">
          Voice examples will be exactly the{' '}
          <em>
            {seedBundle.memberCount} {seedBundle.memberCount === 1 ? 'member' : 'members'} of “
            {seedBundle.name}”
          </em>{' '}
          — not the usual sample. Starred examples still ride on top.
        </p>
      ) : libraryCount === 0 ? (
        <p className="help foot-note">
          No examples yet — add a few in <em>Voice</em> so drafts sound like you.
        </p>
      ) : (
        <p className="help foot-note">
          Drawing on{' '}
          <em>
            {libraryCount} saved {libraryCount === 1 ? 'example' : 'examples'}
          </em>{' '}
          of your writing. More in Voice means a closer match.
        </p>
      )}
    </>
  );
}
