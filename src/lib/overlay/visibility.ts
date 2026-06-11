/**
 * The single overlay render decision — which on-page overlays may paint,
 * given the extension's mirrored state AND X's own UI state. Pure so the
 * policy is testable; the content script supplies the inputs and applies
 * the output (CLAUDE.md §3).
 *
 * Policy (CLAUDE.md §6 + design.md):
 *   - Nothing paints unless a panel is open — x.com stays untouched
 *     whenever the user isn't in our UI.
 *   - The lock highlight requires reply-context mode and a lock, and it
 *     attaches ONLY to the locked tweet itself, wherever that tweet is
 *     rendered — the shell finds it by status id or text identity in
 *     exactly one layer (the open modal when X has one up, the page
 *     otherwise), so nothing ever paints over a modal's scrim or
 *     lingers where the tweet isn't. On SPA navigation the highlight
 *     vanishes with the old view and may re-attach only if the new view
 *     renders the locked tweet (§6: it disappears on navigation; the
 *     lock persists in storage so the panel card stays usable).
 *   - The hover preview requires any active capture mode, and while a
 *     modal is open it follows only modal-resident tweets.
 */
export interface OverlayStateInputs {
  /** At least one side-panel port is open. */
  panelOpen: boolean;
  captureMode: 'none' | 'library' | 'reply-context';
  /** X currently has an `[aria-modal="true"]` layer open. */
  xModalOpen: boolean;
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
    // The lock's layer discipline lives in the shell's scoped article
    // search (modal layer when a modal is up, page otherwise) — a
    // tweet absent from the active layer simply isn't found.
    showLock: state.captureMode === 'reply-context' && state.hasLockTarget,
    showPreview:
      state.captureMode !== 'none' &&
      state.hoveringTweet &&
      (!state.xModalOpen || state.hoveredInModal),
  };
}
