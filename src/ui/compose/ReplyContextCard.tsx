import { useLayoutEffect, useRef, useState } from 'react';
import type { ReplyContext } from '../../types';
import { Avatar } from '../Avatar';
import { IcChevR, IcReply, IcX } from '../icons';
import { formatRelativeTweetTime } from '../../lib/format/relativeTime';

/**
 * Clamped tweet text with X-style "Show more" — a long captured tweet
 * must not dominate the panel's vertical space. Display-only: the lock
 * (and therefore the prompt) always holds the full text. Expands in
 * place with a "Show less" (the LibRow convention), and re-collapses
 * when the text changes (a swapped lock starts compact again). The
 * link renders only when the text actually clamps.
 */
function ClampedText({
  text,
  lines,
  className,
}: {
  text: string;
  lines: 3 | 6;
  className: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [truncatable, setTruncatable] = useState<boolean>(false);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setTruncatable(el.scrollHeight > el.clientHeight + 2);
  }, [text, expanded]);

  return (
    <>
      <p ref={ref} className={`${className} ${expanded ? '' : `clamp-${lines}`}`}>
        {text}
      </p>
      {(truncatable || expanded) && (
        <button type="button" className="lib-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

interface ReplyContextCardProps {
  context: ReplyContext;
  onClear: () => void;
  /** When provided, the card's own header collapses it back to its
   *  compact form (the draft view's peek) — the compact toggle and the
   *  card are the SAME header in two sizes, never two stacked headers. */
  onCollapse?: () => void;
}

/** The captured tweet, rendered X-native style, with a clear control. */
export function ReplyContextCard({ context, onClear, onCollapse }: ReplyContextCardProps) {
  const relTime = formatRelativeTweetTime(context.targetTimestamp);
  return (
    <div className="context-card">
      <div className="ctx-top">
        {onCollapse ? (
          <button
            type="button"
            className="brief-ctx-toggle"
            title="Hide the tweet you're replying to"
            aria-expanded={true}
            onClick={onCollapse}
          >
            <IcReply style={{ width: 15, height: 15, color: 'var(--accent)' }} />
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>
              Replying to
            </span>
            <IcChevR className="ctx-chev open" />
          </button>
        ) : (
          <>
            <IcReply style={{ width: 15, height: 15, color: 'var(--accent)' }} />
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>
              Replying to
            </span>
          </>
        )}
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
          <ClampedText text={context.grandparentText} lines={3} className="ctx-thread-text" />
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
          <ClampedText text={context.targetText} lines={6} className="tn-text" />
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
