/**
 * The single overlay render decision — which on-page overlays may paint,
 * given the extension's mirrored state AND X's own UI state. Pure so the
 * policy is testable; the content script supplies the inputs and applies
 * the output (CLAUDE.md §3).
 *
 * Policy (CLAUDE.md §6 + design.md):
 *   - Nothing paints unless a panel is open — x.com stays untouched
 *     whenever the user isn't in our UI.
 *   - While X has a modal layer up (reply dialog, composer, lightbox),
 *     overlays may paint only on the MODAL's own content — never over
 *     the inert timeline under the scrim. The modal is its own context:
 *     the lock paints there when its tweet is rendered inside it (the
 *     shell scopes the article search to the modal layer), and the
 *     path check is skipped (X's modals are URL-addressable, so the
 *     modal's pathname is noise, not navigation).
 *   - With no modal, the lock highlight requires reply-context mode, a
 *     lock with a status id, and the tab being ON the path where the
 *     lock was last affirmed (§6: overlays disappear on SPA navigation;
 *     the lock itself persists in storage so the panel card stays
 *     usable, and returning to the affirmation path restores the
 *     highlight — a sticky "navigation happened" flag would let a
 *     Reply-modal URL round-trip kill the highlight permanently).
 *   - The hover preview requires any active capture mode, and while a
 *     modal is open it follows only modal-resident tweets.
 */
export interface OverlayStateInputs {
  /** At least one side-panel port is open. */
  panelOpen: boolean;
  captureMode: 'none' | 'library' | 'reply-context';
  /** X currently has an `[aria-modal="true"]` layer open. */
  xModalOpen: boolean;
  /** The tab is currently away from the path where the lock was last
   *  affirmed (selection, mode re-engage, or initial load). */
  awayFromLockPath: boolean;
  /** A reply-context lock exists. (Text identity suffices to find its
   *  article — a status id is not required.) */
  hasLockTarget: boolean;
  /** A tweet article is currently hovered. */
  hoveringTweet: boolean;
  /** The hovered article lives inside the open modal layer. */
  hoveredInModal: boolean;
}

export interface OverlayVisibility {
  showLock: boolean;
  showPreview: boolean;
}

/** Decide which overlays may paint. See the policy in the header. */
export function decideOverlayVisibility(state: OverlayStateInputs): OverlayVisibility {
  if (!state.panelOpen) {
    return { showLock: false, showPreview: false };
  }
  return {
    // Modal open: the lock may paint (the shell searches only the modal
    // layer, so a timeline-only tweet simply isn't found) and the path
    // check is skipped. No modal: page scope + the §6 path rule.
    showLock:
      state.captureMode === 'reply-context' &&
      state.hasLockTarget &&
      (state.xModalOpen || !state.awayFromLockPath),
    showPreview:
      state.captureMode !== 'none' &&
      state.hoveringTweet &&
      (!state.xModalOpen || state.hoveredInModal),
  };
}
