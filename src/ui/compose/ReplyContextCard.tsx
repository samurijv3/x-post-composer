import { useLayoutEffect, useRef, useState } from 'react';
import type { ReplyContext } from '../../types';
import { Avatar } from '../Avatar';
import { IcChevR, IcX } from '../icons';
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
  /** When provided, a collapse chevron returns to the compact peek
   *  (the draft view) — one header, two sizes, never both. */
  onCollapse?: () => void;
  /** Continue the avatar rail down into the composer below (the
   *  pre-draft reply anatomy — X's own reply-composer layout). */
  connectsDown?: boolean;
}

/**
 * The captured tweet as a real tweet on the rail: ancestor (when the
 * target was itself a reply) connects down to the target, which can
 * connect on down to the user's composer. No card chrome.
 */
export function ReplyContextCard({
  context,
  onClear,
  onCollapse,
  connectsDown = false,
}: ReplyContextCardProps) {
  const relTime = formatRelativeTweetTime(context.targetTimestamp);
  const handle = context.targetAuthorHandle;
  return (
    <div className="ctxblock">
      {context.grandparentText && (
        <div className="tweetblock ancestor">
          <div className="tw-rail">
            <span className="avatar av-30">·</span>
            <span className="conn" />
          </div>
          <div className="tw-body">
            <ClampedText text={context.grandparentText} lines={3} className="tw-text tw-dim" />
          </div>
        </div>
      )}
      <div className="tweetblock">
        <div className="tw-rail">
          <Avatar
            src={context.targetAuthorAvatarUrl}
            name={context.targetAuthorDisplayName ?? handle}
          />
          {connectsDown && <span className="conn" />}
        </div>
        <div className="tw-body">
          <div className="tw-head">
            {context.targetAuthorDisplayName && (
              <span className="tw-name">{context.targetAuthorDisplayName}</span>
            )}
            <span className="tw-meta">
              {handle ? `@${handle}` : ''}
              {handle && relTime ? ' · ' : ''}
              {relTime ?? ''}
            </span>
            <span className="head-spacer" />
            {onCollapse && (
              <button
                type="button"
                className="icon-btn tw-x"
                title="Hide the tweet you're replying to"
                aria-label="Hide the tweet you're replying to"
                aria-expanded={true}
                onClick={onCollapse}
              >
                <IcChevR className="ctx-chev open" />
              </button>
            )}
            <button
              type="button"
              className="icon-btn tw-x"
              title="Clear reply context"
              aria-label="Clear reply context"
              onClick={onClear}
            >
              <IcX />
            </button>
          </div>
          <ClampedText text={context.targetText} lines={6} className="tw-text" />
          {context.hadUnreadableMedia && (
            <p className="tw-caveat">
              Media (images / quoted posts) were present but not read — v1 captures text only.
            </p>
          )}
          {handle && (
            <p className="tw-replyingto">
              Replying to <b>@{handle}</b>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
