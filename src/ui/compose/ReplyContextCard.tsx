import type { ReplyContext } from '../../types';
import { Avatar } from '../Avatar';
import { IcReply, IcX } from '../icons';
import { formatRelativeTweetTime } from '../../lib/format/relativeTime';

interface ReplyContextCardProps {
  context: ReplyContext;
  onClear: () => void;
}

/** The captured tweet, rendered X-native style, with a clear control. */
export function ReplyContextCard({ context, onClear }: ReplyContextCardProps) {
  const relTime = formatRelativeTweetTime(context.targetTimestamp);
  return (
    <div className="context-card">
      <div className="ctx-top">
        <IcReply style={{ width: 15, height: 15, color: 'var(--accent)' }} />
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>
          Replying to
        </span>
        <span className="head-spacer" />
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          title="Clear"
          aria-label="Clear reply context"
          onClick={onClear}
        >
          <IcX />
        </button>
      </div>
      {context.grandparentText && (
        <div className="ctx-grand">
          <div className="ctx-thread-label">Earlier in thread</div>
          <p className="ctx-thread-text">{context.grandparentText}</p>
        </div>
      )}
      <div className="tweet-native">
        <Avatar
          src={context.targetAuthorAvatarUrl}
          name={context.targetAuthorDisplayName ?? context.targetAuthorHandle}
        />
        <div className="tweet-native-body">
          <div className="tweet-native-head">
            {context.targetAuthorDisplayName && (
              <span className="tn-name">{context.targetAuthorDisplayName}</span>
            )}
            {context.targetAuthorHandle && (
              <span className="tn-handle">@{context.targetAuthorHandle}</span>
            )}
            {relTime && (
              <>
                <span className="tn-dot">·</span>
                <span className="tn-time">{relTime}</span>
              </>
            )}
          </div>
          <p className="tn-text">{context.targetText}</p>
          {context.hadUnreadableMedia && (
            <p className="help" style={{ marginTop: 6 }}>
              Media (images / quoted posts) were present but not read — v1 captures text only.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
