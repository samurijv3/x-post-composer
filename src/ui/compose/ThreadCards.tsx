import type { Span } from '../../lib/exclusion';
import { X_HARD_LIMIT } from '../../lib/counting';
import { IcCheck, IcCopy } from '../icons';
import { DraftEditor } from './DraftEditor';

/** One post of a thread draft, as the cards render it. */
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
  busy: boolean;
  onEditPost: (postIndex: number, text: string) => void;
  onCopyPost: (postIndex: number) => void;
}

/**
 * A thread draft as ordered cards — mirroring how X's native thread
 * composer works, one post at a time. Each card is the same directly-
 * editable surface as a single draft (DraftEditor: real textarea +
 * violation backdrop) with its own ordinal, weighted count, and copy
 * button. Copying every card commits the draft (the lifecycle's
 * all-copied rule).
 */
export function ThreadCards({ posts, charCap, busy, onEditPost, onCopyPost }: ThreadCardsProps) {
  return (
    <ol className="thread-cards">
      {posts.map((post, i) => (
        <li key={i} className={`thread-card ${post.copied ? 'tc-copied' : ''}`}>
          <div className="tc-head">
            <span className="tc-ordinal">
              {i + 1}/{posts.length}
            </span>
            <span className="head-spacer" />
            <span
              className={`count ${post.over ? 'over' : ''}`}
              title="X-weighted count — URLs always count as 23, some characters as 2"
            >
              {post.count}
              {charCap ? ` / ${X_HARD_LIMIT}` : ' chars'}
            </span>
            <button
              type="button"
              className={`icon-btn tc-copy ${post.copied ? 'is-on' : ''}`}
              title={post.copied ? 'Copied — edit to re-arm' : `Copy post ${String(i + 1)}`}
              aria-label={
                post.copied ? `Post ${String(i + 1)} copied` : `Copy post ${String(i + 1)}`
              }
              disabled={busy}
              onClick={() => onCopyPost(i)}
            >
              {post.copied ? <IcCheck /> : <IcCopy />}
            </button>
          </div>
          <DraftEditor
            text={post.text}
            violations={post.residualViolations}
            disabled={busy}
            onEdit={(text) => onEditPost(i, text)}
          />
        </li>
      ))}
    </ol>
  );
}
