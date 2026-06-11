/**
 * Content script that runs on X.com / twitter.com pages.
 *
 * Responsibilities (CLAUDE.md §6):
 *   - Read-only contact with X's existing DOM. We may extend it with
 *     our own elements (the overlay) per the carve-out in §6, but we
 *     never modify X's tree.
 *   - Never reads or holds the API key.
 *   - Never auto-posts. The single output path is the clipboard, owned
 *     by the panel.
 *   - Failures degrade gracefully — extraction errors surface as a
 *     clear notice rather than throwing into the page.
 *
 * Architecture:
 *   - This file is the wiring: state mirrored from the background,
 *     event listeners, and the positioning loop.
 *   - `extract.ts` owns every read of X's DOM (pure Element → data).
 *   - `overlay.ts` owns the §6 overlay carve-out (the only writes).
 *   - A single capture-mode value (`'none' | 'library' | 'reply-context'`)
 *     drives click behavior + overlay visibility.
 *   - A reply-context lock (`ReplyContext | null`) drives the locked
 *     highlight overlay; both pieces of state live in the background's
 *     chrome.storage.session and are mirrored here via messaging.
 *   - X's own UI state feeds the same decision: while a modal layer
 *     (`aria-modal`) is open, overlays paint only on the modal's own
 *     content (never over the scrim); with no modal, the lock highlight
 *     paints only while the tab is on the path where the lock was
 *     affirmed (CLAUDE.md §6 — it hides on SPA navigation and returns
 *     with the path, surviving X's URL-addressable modals). The policy
 *     itself is pure and tested — `lib/overlay`.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendOneWay } from '../../src/messaging';
import type { ReplyContext } from '../../src/types';
import type { ActiveCaptureMode } from '../../src/storage/captureMode';
import { decideOverlayVisibility } from '../../src/lib/overlay';
import {
  extractReplyContextFromArticle,
  extractReplyContextFromComposer,
  extractTweet,
  findArticleByStatusId,
  findArticleByTweetText,
  isTweetTruncated,
  isXModalOpen,
} from './extract';
import { createOverlaySystem } from './overlay';

type Mode = ActiveCaptureMode;

export default defineContentScript({
  matches: [
    'https://x.com/*',
    'https://www.x.com/*',
    'https://twitter.com/*',
    'https://www.twitter.com/*',
  ],
  runAt: 'document_idle',
  main() {
    // ---------------------------------------------------------------
    // Extension-alive probe (orphaned content script after reload)
    // ---------------------------------------------------------------
    let extensionAlive = true;
    const isAlive = (): boolean => {
      if (!extensionAlive) return false;
      try {
        if (!chrome.runtime?.id) {
          extensionAlive = false;
          return false;
        }
      } catch {
        extensionAlive = false;
        return false;
      }
      return true;
    };

    // ---------------------------------------------------------------
    // Mirrored state from background
    // ---------------------------------------------------------------
    let captureMode: Mode = 'none';
    let replyContextLock: ReplyContext | null = null;
    // True only when at least one side-panel port is open. Drives
    // overlay visibility: we never paint anything on x.com unless the
    // user is actively in our UI.
    let panelOpen = false;
    // X's own UI state, mirrored into the render decision. Modal state
    // is re-scanned on the same throttle as the lock article; the
    // pathname is compared every frame (a property read — free).
    let xModalOpen = false;
    let currentPath = window.location.pathname;
    // The path where the lock was last affirmed in THIS tab (selection
    // push, mode re-engage, or the initial load fetch). The highlight
    // paints only while the tab is on that path — §6's
    // disappear-on-navigation, derived from the current path rather
    // than a sticky "navigation happened" flag because X's modals are
    // URL-addressable (Reply pushes /compose/post and pops back on
    // close; a sticky flag killed the highlight permanently after any
    // modal round-trip — found in the Phase 2 field pass). The lock
    // itself is preserved in storage so the captured ReplyContext stays
    // usable for generation; the panel card remains throughout.
    let lockAffirmedPath: string | null = null;

    function awayFromLockPath(): boolean {
      return lockAffirmedPath !== null && lockAffirmedPath !== window.location.pathname;
    }

    /**
     * Resolve the locked tweet's article in the given layer: by status
     * id when the lock carries one, falling back to text identity —
     * the same-tweet rule the merge uses — for renderings that carry
     * no /status/ link (X's modal copies). This is what lets the
     * highlight FOLLOW the lock into a modal that re-renders it.
     */
    function findLockArticle(scope: 'page' | 'modal'): Element | null {
      if (replyContextLock === null) return null;
      const byId = replyContextLock.targetStatusId
        ? findArticleByStatusId(replyContextLock.targetStatusId, scope)
        : null;
      return byId ?? findArticleByTweetText(replyContextLock.targetText, scope);
    }

    /**
     * Whether the overlay's current lock target may keep painting even
     * when both identity searches come up empty (e.g. X re-rendered
     * the text mid-animation). Keep it while it stays connected and
     * lives in the active layer (modal content while a modal is open;
     * page content otherwise).
     */
    function currentLockTargetStillValid(current: Element | null): current is Element {
      if (current === null || !current.isConnected) return false;
      const inModal = current.closest('[aria-modal="true"]') !== null;
      if (xModalOpen) return inModal;
      return !inModal && current.closest('[role="dialog"]') === null;
    }

    // ---------------------------------------------------------------
    // Overlay system
    // ---------------------------------------------------------------
    const overlay = createOverlaySystem({
      onDismiss: () => {
        // Optimistic local clear FIRST, so the × feels identical to the
        // panel card's trashcan (which clears via its own subscription
        // instantly) instead of waiting three async hops for the push —
        // and so the highlight still dies when this script has been
        // orphaned by an extension reload (a zombie highlight with a
        // dead × was the worst failure mode). The authoritative null
        // arrives back as a lock-state push; in the rare alive-but-
        // send-failed case the panel card still shows the lock and its
        // trashcan remains the recovery path.
        replyContextLock = null;
        lockAffirmedPath = null;
        applyOverlayState();
        if (!isAlive()) return;
        sendOneWay({ type: 'content:dismiss-reply-context' });
      },
    });

    function applyOverlayState(): void {
      // The policy lives in lib (decideOverlayVisibility, tested);
      // this shell only supplies inputs and applies the verdict.
      const verdict = decideOverlayVisibility({
        panelOpen,
        captureMode,
        xModalOpen,
        awayFromLockPath: awayFromLockPath(),
        hasLockTarget: replyContextLock !== null,
        hoveringTweet: hoveredArticle !== null,
        hoveredInModal:
          hoveredArticle !== null && hoveredArticle.closest('[aria-modal="true"]') !== null,
      });

      // Modal open → search only the modal's layer (its copy is the one
      // the user is working with); otherwise page scope, which skips
      // dialog-resident copies. When both identity searches miss but
      // the existing target is still connected in the active layer,
      // keep it.
      let lockArticle = verdict.showLock ? findLockArticle(xModalOpen ? 'modal' : 'page') : null;
      if (lockArticle === null && verdict.showLock) {
        const current = overlay.getLockTarget();
        if (currentLockTargetStillValid(current)) lockArticle = current;
      }
      overlay.setLock(lockArticle);

      // Preview is suppressed when hovering the locked article so we
      // don't paint two overlays on the same tweet.
      overlay.setPreview(
        verdict.showPreview && hoveredArticle !== lockArticle ? hoveredArticle : null,
      );
    }

    // ---------------------------------------------------------------
    // State pushes / requests
    // ---------------------------------------------------------------

    /**
     * Panel-open state is a lease, not a one-shot: the background
     * worker can be killed and restarted (losing its in-memory port
     * set) without this tab hearing about it, so trusting pushes alone
     * can leave `panelOpen` stale in both directions. Re-validate on
     * demand. Stale-false heals itself when the panel's port reconnects
     * (the background pushes `isOpen: true`); stale-true — overlays
     * painting with the panel closed — is the case this must catch.
     */
    function refreshPanelState(): void {
      if (!isAlive()) return;
      try {
        void chrome.runtime
          .sendMessage({ type: 'content:check-panel-state' })
          .then((reply: unknown) => {
            if (isPanelState(reply)) {
              panelOpen = reply.isOpen;
              applyOverlayState();
            }
          })
          .catch(() => {});
      } catch {
        extensionAlive = false;
      }
    }

    try {
      void chrome.runtime
        .sendMessage({ type: 'content:check-capture-mode' })
        .then((reply: unknown) => {
          if (isCaptureModeState(reply)) {
            captureMode = reply.mode;
            applyOverlayState();
          }
        })
        .catch(() => {});
      void chrome.runtime
        .sendMessage({ type: 'content:check-reply-context-lock' })
        .then((reply: unknown) => {
          if (isReplyContextLockState(reply)) {
            replyContextLock = reply.lock;
            // A fresh page load lands wherever the lock is relevant —
            // affirm here so the highlight can paint on this page.
            lockAffirmedPath = reply.lock === null ? null : window.location.pathname;
            applyOverlayState();
          }
        })
        .catch(() => {});
    } catch {
      extensionAlive = false;
    }
    refreshPanelState();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshPanelState();
    });
    // Re-validate only while we believe the panel is open — the lease
    // exists to clear overlays that would otherwise outlive the panel.
    const panelLease = window.setInterval(() => {
      if (panelOpen) refreshPanelState();
    }, 30_000);

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isAlive()) return false;

      if (isCaptureModeState(message)) {
        // Re-engaging reply-context mode is a fresh user gesture — it
        // re-affirms the lock on the page the user is now on, lifting
        // any navigation suppression. Not while a modal is up, though:
        // the modal's pathname is transient noise, and the pre-modal
        // affirmation is where the highlight should resume on close.
        if (message.mode === 'reply-context' && captureMode !== 'reply-context') {
          if (replyContextLock !== null && !xModalOpen) {
            lockAffirmedPath = window.location.pathname;
          }
        }
        captureMode = message.mode;
        applyOverlayState();
        return false;
      }

      if (isReplyContextLockState(message)) {
        // A new lock (the user clicked a tweet, possibly in another
        // tab) re-affirms the highlight for THIS tab's current page —
        // unless a modal is open: a selection made inside a modal keeps
        // the pre-modal affirmation, so closing the modal hands the
        // highlight back to the underlying page (the modal's own URL is
        // noise, not a place to anchor to).
        if (message.lock === null) {
          lockAffirmedPath = null;
        } else if (!xModalOpen || lockAffirmedPath === null) {
          lockAffirmedPath = window.location.pathname;
        }
        replyContextLock = message.lock;
        applyOverlayState();
        return false;
      }

      if (isPanelState(message)) {
        panelOpen = message.isOpen;
        applyOverlayState();
        return false;
      }

      if (isReplyContextRequest(message)) {
        try {
          const ctx = extractReplyContextFromComposer();
          if (ctx === null) {
            sendResponse({
              ok: false,
              message:
                "No open composer found. Click X's native Reply button on a tweet, then try again.",
            });
          } else if ('error' in ctx) {
            sendResponse({ ok: false, message: ctx.error });
          } else {
            sendResponse({ ok: true, context: ctx });
          }
        } catch (error) {
          sendResponse({
            ok: false,
            message:
              error instanceof Error
                ? `Could not read reply context: ${error.message}`
                : 'Could not read reply context.',
          });
        }
        return true;
      }
      return false;
    });

    // ---------------------------------------------------------------
    // Hover detection — drives preview overlay
    // ---------------------------------------------------------------
    let hoveredArticle: Element | null = null;

    document.addEventListener('mouseover', (event) => {
      // No mode active or panel closed → no preview, no work to do.
      if (captureMode === 'none' || !panelOpen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const article = target.closest('article[data-testid="tweet"]');
      if (!article) {
        if (hoveredArticle !== null) {
          hoveredArticle = null;
          applyOverlayState();
        }
        return;
      }
      // We deliberately do NOT suppress the preview when hovering over
      // interactive children (Show more, links, action buttons). The
      // preview communicates "this is the tweet you're hovering," not
      // "this is what a click will capture." Click-routing in the
      // capture-phase listener handles interactive elements correctly
      // by passing them through to X.
      if (article !== hoveredArticle) {
        hoveredArticle = article;
        applyOverlayState();
      }
    });

    document.addEventListener('mouseout', (event) => {
      // Only clear when the mouse leaves the entire document (related
      // target is null). Element-to-element mouseouts inside the
      // document are noisy and the corresponding mouseover handles them.
      if (event.relatedTarget !== null) return;
      if (hoveredArticle !== null) {
        hoveredArticle = null;
        applyOverlayState();
      }
    });

    // ---------------------------------------------------------------
    // Click handling
    //
    // Branching by mode:
    //   - library:        existing flow — extract + send for save.
    //   - reply-context:  new flow — extract reply context + send for lock.
    //   - none:           let X's UI handle the click.
    // ---------------------------------------------------------------
    document.addEventListener(
      'click',
      (event) => {
        if (captureMode === 'none') return;
        if (!isAlive()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;

        const article = target.closest('article[data-testid="tweet"]');
        if (!article) return;

        // Let X handle clicks on interactive children regardless of
        // mode (Show more, action buttons, links).
        if (target.closest('button, a, [role="button"], [role="link"]')) {
          return;
        }

        // Don't intercept clicks on our own overlay's dismiss control.
        if (target.closest('[data-margin-overlay]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (captureMode === 'library') {
          runLibraryCapture(article);
        } else if (captureMode === 'reply-context') {
          runReplyContextSelect(article);
        }
      },
      { capture: true },
    );

    function runLibraryCapture(article: Element): void {
      try {
        if (isTweetTruncated(article)) {
          sendOneWay({ type: 'content:capture-failed', reason: 'truncated' });
          return;
        }
        const capture = extractTweet(article);
        if (
          capture === 'missing-text' ||
          capture === 'missing-author' ||
          capture === 'media-only'
        ) {
          sendOneWay({ type: 'content:capture-failed', reason: capture });
          return;
        }
        sendOneWay({ type: 'content:captured-tweet', payload: capture });
      } catch {
        sendOneWay({ type: 'content:capture-failed', reason: 'unknown' });
      }
    }

    function runReplyContextSelect(article: Element): void {
      // Failures in reply-context mode flow through a separate
      // message so the panel can surface a reply-context-appropriate
      // toast instead of a "didn't save to voice" banner.
      try {
        if (isTweetTruncated(article)) {
          sendOneWay({ type: 'content:reply-context-failed', reason: 'truncated' });
          return;
        }
        const ctx = extractReplyContextFromArticle(article);
        if ('error' in ctx) {
          const reason = ctx.error.includes('media-only') ? 'media-only' : 'unknown';
          sendOneWay({ type: 'content:reply-context-failed', reason });
          return;
        }
        sendOneWay({ type: 'content:reply-context-selected', context: ctx });
        // The user clicked THIS article — affirm it as the highlight
        // target immediately rather than waiting for the round-trip,
        // which cannot re-find modal-rendered copies by status id (they
        // carry no /status/ link). The authoritative lock push follows;
        // currentLockTargetStillValid keeps this element painted while
        // it stays connected in the active layer.
        if (panelOpen) overlay.setLock(article);
      } catch {
        sendOneWay({ type: 'content:reply-context-failed', reason: 'unknown' });
      }
    }

    // ---------------------------------------------------------------
    // rAF positioning loop + SPA-navigation watch
    //
    // A single requestAnimationFrame loop keeps overlay positions in
    // sync with their target articles (scroll, layout shifts, virtual-
    // scroll remount). Idle iterations (no overlay visible) perform no
    // DOM queries.
    //
    // rAF caps work at ~60fps and skips when the tab is hidden.
    // ---------------------------------------------------------------

    // DOM scans (the lock re-find, the modal probe) are queries on
    // someone else's site — too expensive to run per frame. The cached
    // lock element going stale (X's virtual scroller unmounting it) is
    // detected instantly via isConnected; a ~200ms periodic scan covers
    // everything else. The pathname compare IS per-frame — it's a
    // property read, and §6's disappear-on-navigation should not lag.
    const STATE_RESCAN_MS = 200;
    let lastStateScan = 0;
    let rafId = window.requestAnimationFrame(function tick(now) {
      try {
        // SPA navigation (X is a single-page app — pushState, no page
        // load). §6: the highlight disappears off the affirmation path
        // and returns on it (modal URL round-trips included); lock
        // storage and the panel card are untouched either way.
        if (window.location.pathname !== currentPath) {
          currentPath = window.location.pathname;
          applyOverlayState();
        }

        // Anything painted (or eligible to paint)? Keep X's modal state
        // and the lock article fresh on the shared throttle.
        if (panelOpen && captureMode !== 'none') {
          const current = overlay.getLockTarget();
          const targetLost = current !== null && !current.isConnected;
          if (targetLost || now - lastStateScan >= STATE_RESCAN_MS) {
            lastStateScan = now;

            const modalNow = isXModalOpen();
            if (modalNow !== xModalOpen) {
              xModalOpen = modalNow;
              applyOverlayState();
            }

            // Re-find the lock article only while it may paint (modal
            // open → modal scope; otherwise page scope + path rule).
            // findLockArticle tries the status id then text identity,
            // so the highlight follows the lock into a modal that
            // re-renders the same tweet. When both searches miss, the
            // highlight hides — unless the current target is still
            // valid in the active layer. Storage is preserved either
            // way so generation can still use the context.
            if (
              (xModalOpen || !awayFromLockPath()) &&
              captureMode === 'reply-context' &&
              replyContextLock !== null
            ) {
              const fresh = findLockArticle(xModalOpen ? 'modal' : 'page');
              if (fresh !== current && (fresh !== null || !currentLockTargetStillValid(current))) {
                overlay.setLock(fresh);
              }
            }
          }
        }

        overlay.reposition();
      } catch {
        // Defensive — never let the loop throw into the page.
      }
      rafId = window.requestAnimationFrame(tick);
    });

    window.addEventListener('beforeunload', () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(panelLease);
      overlay.destroy();
    });
  },
});

// =====================================================================
// Type guards for messages arriving from the background
// =====================================================================

function isCaptureModeState(
  value: unknown,
): value is { type: 'bg:capture-mode-state'; mode: Mode } {
  if (typeof value !== 'object' || value === null) return false;
  if ((value as { type?: unknown }).type !== 'bg:capture-mode-state') return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === 'none' || mode === 'library' || mode === 'reply-context';
}

function isReplyContextLockState(
  value: unknown,
): value is { type: 'bg:reply-context-lock-state'; lock: ReplyContext | null } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'bg:reply-context-lock-state'
  );
}

function isReplyContextRequest(
  value: unknown,
): value is { type: 'bg:capture-reply-context-request' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'bg:capture-reply-context-request'
  );
}

function isPanelState(value: unknown): value is { type: 'bg:panel-state'; isOpen: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'bg:panel-state' &&
    typeof (value as { isOpen?: unknown }).isOpen === 'boolean'
  );
}
