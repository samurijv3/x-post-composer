/**
 * The single overlay render decision — which on-page overlays may paint,
 * given the extension's mirrored state AND X's own UI state. Pure so the
 * policy is testable; the content script supplies the inputs and applies
 * the output (CLAUDE.md §3).
 *
 * Policy (CLAUDE.md §6 + design.md):
 *   - Nothing paints unless a panel is open — x.com stays untouched
 *     whenever the user isn't in our UI.
 *   - Nothing paints while X has a modal layer up (reply dialog,
 *     composer, lightbox). The timeline under the scrim is inert, so an
 *     informational highlight there is pure noise floating over X's UI.
 *   - The lock highlight additionally requires reply-context mode, a
 *     lock with a status id, and no SPA navigation since the lock was
 *     last affirmed (§6: overlays disappear on SPA navigation; the lock
 *     itself persists in storage so the panel card stays usable).
 *   - The hover preview requires any active capture mode.
 */
export interface OverlayStateInputs {
  /** At least one side-panel port is open. */
  panelOpen: boolean;
  captureMode: 'none' | 'library' | 'reply-context';
  /** X currently has an `[aria-modal="true"]` layer open. */
  xModalOpen: boolean;
  /** The pathname changed after the lock was last set / mode re-engaged. */
  navigatedSinceLock: boolean;
  /** A reply-context lock with a targetStatusId exists. */
  hasLockTarget: boolean;
  /** A tweet article is currently hovered. */
  hoveringTweet: boolean;
}

export interface OverlayVisibility {
  showLock: boolean;
  showPreview: boolean;
}

/** Decide which overlays may paint. See the policy in the header. */
export function decideOverlayVisibility(state: OverlayStateInputs): OverlayVisibility {
  if (!state.panelOpen || state.xModalOpen) {
    return { showLock: false, showPreview: false };
  }
  return {
    showLock:
      state.captureMode === 'reply-context' && state.hasLockTarget && !state.navigatedSinceLock,
    showPreview: state.captureMode !== 'none' && state.hoveringTweet,
  };
}
