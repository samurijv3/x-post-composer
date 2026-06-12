import { IcChevDown, IcChevUp } from '../icons';
import type { ThreadModeControls } from './types';

/** Stepper bounds: a 1-post thread is just a post, and the roadmap's
 *  stretched-thread ceiling is single digits. */
export const THREAD_TARGET_MIN = 2;
export const THREAD_TARGET_MAX = 9;

/**
 * The post↔thread mode switch with the ≈N target stepper (thread mode
 * only). Lives in the grounding cluster of both compose states; hidden
 * entirely while a reply context exists (posts-only threads in v1).
 */
export function ModeControls({ controls }: { controls: ThreadModeControls }) {
  const { composeMode, onSetMode, target, onSetTarget, busy } = controls;
  return (
    <div className="mode-controls">
      <div className="seg" style={{ flex: '0 0 auto' }}>
        <button
          type="button"
          className={composeMode === 'single' ? 'active' : ''}
          onClick={() => onSetMode('single')}
          style={{ padding: '5px 12px' }}
        >
          Post
        </button>
        <button
          type="button"
          className={composeMode === 'thread' ? 'active' : ''}
          title="Compose a thread — one post followed by successive posts"
          onClick={() => onSetMode('thread')}
          style={{ padding: '5px 12px' }}
        >
          Thread
        </button>
      </div>
      {composeMode === 'thread' && (
        <div
          className="thread-target"
          title="A soft target — the model aims for about this many posts; over an active draft, changing it repacks the same content"
        >
          <span className="fld-label">≈</span>
          <button
            type="button"
            className="icon-btn tt-step"
            aria-label="Fewer posts"
            disabled={busy || target <= THREAD_TARGET_MIN}
            onClick={() => onSetTarget(Math.max(THREAD_TARGET_MIN, target - 1))}
          >
            <IcChevDown />
          </button>
          <span className="tt-count">{target}</span>
          <button
            type="button"
            className="icon-btn tt-step"
            aria-label="More posts"
            disabled={busy || target >= THREAD_TARGET_MAX}
            onClick={() => onSetTarget(Math.min(THREAD_TARGET_MAX, target + 1))}
          >
            <IcChevUp />
          </button>
          <span className="fld-label">posts</span>
        </div>
      )}
    </div>
  );
}
