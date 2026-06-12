import type { Span } from '../../lib/exclusion';
import { X_HARD_LIMIT } from '../../lib/counting';
import { IcCheck, IcCopy, IcRefresh, IcTarget } from '../icons';
import { CountRing } from './CountRing';
import { DraftEditor } from './DraftEditor';
import { ViolationNote } from './ViolationNote';
import { monogram } from './monogram';

/** One post of a thread draft, as the segments render it. */
export interface DraftPostViewModel {
  text: string;
  residualViolations: Span[];
  /** Copied since this post's text last changed (lifecycle flag). */
  copied: boolean;
  /** X-weighted count. */
  count: number;
  over: boolean;
}

interface ThreadCardsProps {
  posts: DraftPostViewModel[];
  charCap: boolean;
  softCapChars: number;
  busy: boolean;
  /** The user's @handle — every segment wears their avatar. */
  handle: string;
  /** The post the refine controls are aimed at (scope), or null. */
  aimedPost: number | null;
  onEditPost: (postIndex: number, text: string) => void;
  onCopyPost: (postIndex: number) => void;
  /** Scoped fresh take on one post (splice-guarded downstream). */
  onRewritePost: (postIndex: number) => void;
  /** Aim chips + the steer box at this post (toggles off on re-click). */
  onAimPost: (postIndex: number) => void;
}

/**
 * A thread draft as X's own self-thread anatomy: avatar rail +
 * connector, each segment directly editable (DraftEditor). Copied
 * segments dim behind a green check; uncopied ones keep their ring,
 * count, and per-post actions (copy / rewrite / aim). The aimed
 * segment wears a 2px blue inset ring + tag — deliberately the same
 * visual as the on-page lock overlay.
 */
export function ThreadCards({
  posts,
  charCap,
  softCapChars,
  busy,
  handle,
  aimedPost,
  onEditPost,
  onCopyPost,
  onRewritePost,
  onAimPost,
}: ThreadCardsProps) {
  return (
    <div className="tsegs">
      {posts.map((post, i) => (
        <div
          key={i}
          className={`tseg ${post.copied ? 'copied' : ''} ${aimedPost === i ? 'aimed' : ''}`}
        >
          {aimedPost === i && <span className="aimtag">aimed</span>}
          <div className="tseg-rail">
            <span className="avatar av-36">{monogram(handle)}</span>
            {i < posts.length - 1 && <span className="conn" />}
          </div>
          <div className="tseg-body">
            <DraftEditor
              text={post.text}
              violations={post.residualViolations}
              disabled={busy}
              onEdit={(text) => onEditPost(i, text)}
            />
            {post.residualViolations.length > 0 && (
              <ViolationNote violations={post.residualViolations} />
            )}
            <div className="tseg-foot">
              {post.copied ? (
                <span className="done">
                  <IcCheck /> copied
                </span>
              ) : (
                <>
                  <CountRing
                    count={post.count}
                    limit={X_HARD_LIMIT}
                    over={charCap ? post.over : post.count > softCapChars}
                    beyond={!charCap && post.count > X_HARD_LIMIT && post.count <= softCapChars}
                    committed={false}
                  />
                  <span className={`count ${post.over ? 'over' : ''}`}>{post.count}</span>
                  <span className="head-spacer" />
                  <button
                    type="button"
                    className="icon-btn sm"
                    title={`Copy post ${String(i + 1)}`}
                    aria-label={`Copy post ${String(i + 1)}`}
                    disabled={busy}
                    onClick={() => onCopyPost(i)}
                  >
                    <IcCopy />
                  </button>
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Rewrite this post — fresh take, same beat (the rest of the thread is untouched)"
                    aria-label={`Rewrite post ${String(i + 1)}`}
                    disabled={busy}
                    onClick={() => onRewritePost(i)}
                  >
                    <IcRefresh />
                  </button>
                  <button
                    type="button"
                    className={`icon-btn sm ${aimedPost === i ? 'is-aimed' : ''}`}
                    title={
                      aimedPost === i
                        ? 'Refines aim here — click to clear'
                        : 'Aim chips & steering at this post only'
                    }
                    aria-label={`Aim refines at post ${String(i + 1)}`}
                    aria-pressed={aimedPost === i}
                    disabled={busy}
                    onClick={() => onAimPost(i)}
                  >
                    <IcTarget filled={aimedPost === i} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
