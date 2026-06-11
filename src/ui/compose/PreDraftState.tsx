import { IcSparkle } from '../icons';
import { CapToggle } from './CapToggle';
import { ErrorCard, type ErrorKind } from './ErrorCard';
import { ReplyContextBanner } from './ReplyContextBanner';
import { ReplyContextCard } from './ReplyContextCard';
import type { BriefControls, ReplyContextControls } from './types';

interface PreDraftProps {
  reply: ReplyContextControls;
  brief: BriefControls;
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
  busy,
  libraryCount,
  error,
  onGenerate,
  onRetry,
  onOpenOptions,
}: PreDraftProps) {
  const hasContext = reply.replyContext !== null;
  const canGenerate = brief.bullets.trim() !== '' && !busy;
  return (
    <>
      {reply.replyContext !== null ? (
        <ReplyContextCard context={reply.replyContext} onClear={reply.onClearReplyContext} />
      ) : (
        <ReplyContextBanner
          on={reply.captureModeIsReplyContext}
          onToggle={reply.onToggleReplyContextMode}
        />
      )}

      <label className="fld compose-input">
        <span className="fld-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasContext ? 'Your angle' : 'What do you want to say?'}
          <span className="head-spacer" />
          <button
            type="button"
            className={`minitoggle ${brief.bulleted ? 'on' : 'off'}`}
            title={
              brief.bulleted
                ? 'Bullet mode is ON — Enter starts the next bullet; bullets are read as loose thoughts to weave together'
                : 'Bullet mode — write loose thoughts as real bullets'
            }
            onClick={(e) => {
              e.preventDefault();
              brief.setBulleted(!brief.bulleted);
            }}
          >
            • bullets
          </button>
        </span>
        <textarea
          rows={4}
          value={brief.bullets}
          onKeyDown={brief.onGenKey}
          onChange={(e) => brief.setBullets(e.target.value)}
          placeholder={
            hasContext
              ? 'the point you want to make\nany detail to include'
              : 'the topic\nyour angle\nany detail to include'
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
