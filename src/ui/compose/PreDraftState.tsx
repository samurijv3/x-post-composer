import { IcSparkle } from '../icons';
import { BundlePicker } from './BundlePicker';
import { CapToggle } from './CapToggle';
import { ErrorCard, type ErrorKind } from './ErrorCard';
import { ReplyContextBanner } from './ReplyContextBanner';
import { ReplyContextCard } from './ReplyContextCard';
import type { BriefControls, BundlePickerControls, ReplyContextControls } from './types';

interface PreDraftProps {
  reply: ReplyContextControls;
  brief: BriefControls;
  /** Null when no bundles exist — the picker hides entirely. */
  bundlePicker: BundlePickerControls | null;
  busy: boolean;
  libraryCount: number;
  error: ErrorKind | null;
  onGenerate: () => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

/** Pre-draft state — the full input form before anything is generated. */
export function PreDraftState({
  reply,
  brief,
  bundlePicker,
  busy,
  libraryCount,
  error,
  onGenerate,
  onRetry,
  onOpenOptions,
}: PreDraftProps) {
  const hasContext = reply.replyContext !== null;
  const canGenerate = brief.bullets.trim() !== '' && !busy;
  const seedBundle = bundlePicker?.bundles.find((b) => b.id === bundlePicker.selectedId) ?? null;
  return (
    <>
      {/* The grounding cluster: what to react to (reply context) and
          what to sound like (the voice seed) — both concrete anchors,
          set together before the angle is typed. */}
      <div className="grounding">
        {reply.replyContext !== null ? (
          <ReplyContextCard context={reply.replyContext} onClear={reply.onClearReplyContext} />
        ) : (
          <ReplyContextBanner
            on={reply.captureModeIsReplyContext}
            onToggle={reply.onToggleReplyContextMode}
          />
        )}
        {bundlePicker && <BundlePicker picker={bundlePicker} />}
      </div>

      <label className="fld compose-input">
        <span className="fld-label">{hasContext ? 'Your angle' : 'What do you want to say?'}</span>
        <textarea
          rows={4}
          value={brief.bullets}
          onKeyDown={brief.onGenKey}
          onChange={(e) => brief.setBullets(e.target.value)}
          placeholder={
            hasContext
              ? 'the point you want to make\nany detail to include\n(start a line with "- " for bullets)'
              : 'the topic\nyour angle\nany detail to include\n(start a line with "- " for bullets)'
          }
        />
      </label>

      <div className="compose-tools">
        <CapToggle charCap={brief.charCap} setCharCap={brief.setCharCap} />
        {!brief.charCap && <span className="help">soft cap {brief.softCapChars}</span>}
      </div>

      <button
        type="button"
        className="btn primary lg block"
        disabled={!canGenerate}
        onClick={onGenerate}
        title="⌘↵ to generate"
      >
        {busy ? (
          'Drafting…'
        ) : (
          <>
            <IcSparkle /> {hasContext ? 'Generate reply' : 'Generate post'}
            <span className="kbd kbd-on">⌘↵</span>
          </>
        )}
      </button>

      {error ? (
        <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />
      ) : seedBundle ? (
        <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
          Voice examples will be exactly the{' '}
          <em>
            {seedBundle.memberCount} {seedBundle.memberCount === 1 ? 'member' : 'members'} of “
            {seedBundle.name}”
          </em>{' '}
          — not the usual sample. Starred examples still ride on top.
        </p>
      ) : libraryCount === 0 ? (
        <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
          No examples yet — add a few in <em>Voice</em> so drafts sound like you.
        </p>
      ) : (
        <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
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
