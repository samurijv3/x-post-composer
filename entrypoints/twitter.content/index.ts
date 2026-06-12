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
 *     content (never over the scrim). The lock highlight attaches to
 *     the locked tweet itself wherever it is rendered — found by
 *     status id or text identity in exactly one layer — so it vanishes
 *     with a view that doesn't render the tweet and re-attaches in one
 *     that does (CLAUDE.md §6). The policy itself is pure and tested —
 *     `lib/overlay`.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendOneWay, type CaptureNavKey } from '../../src/messaging';
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
  collectSelfThreadSpine,
  extractThread,
  stepToAdjacentArticle,
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
    // (No path anchoring: the highlight simply attaches to the locked
    // tweet wherever the active layer renders it. Three rounds of
    // path-affirmation machinery each broke a different real flow —
    // X's modals push and pop URLs too freely to anchor against; see
    // the Build Decisions Log. The lock lives in storage either way,
    // so the panel card and generation never depended on any of this.)

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
    /**
     * Clear the reply-context lock from the page side — the overlay's
     * × and the Escape key share this. Optimistic local clear FIRST,
     * so it feels identical to the panel card's trashcan (which clears
     * via its own subscription instantly) instead of waiting three
     * async hops for the push — and so the highlight still dies when
     * this script has been orphaned by an extension reload (a zombie
     * highlight with a dead × was the worst failure mode). The
     * authoritative null arrives back as a lock-state push; in the
     * rare alive-but-send-failed case the panel card still shows the
     * lock and its trashcan remains the recovery path.
     */
    function dismissReplyContext(): void {
      replyContextLock = null;
      applyOverlayState();
      if (!isAlive()) return;
      sendOneWay({ type: 'content:dismiss-reply-context' });
    }

    const overlay = createOverlaySystem({ onDismiss: dismissReplyContext });

    function applyOverlayState(): void {
      // The policy lives in lib (decideOverlayVisibility, tested);
      // this shell only supplies inputs and applies the verdict.
      const verdict = decideOverlayVisibility({
        panelOpen,
        captureMode,
        xModalOpen,
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
        captureMode = message.mode;
        applyOverlayState();
        return false;
      }

      if (isReplyContextLockState(message)) {
        replyContextLock = message.lock;
        applyOverlayState();
        return false;
      }

      if (isPanelState(message)) {
        panelOpen = message.isOpen;
        applyOverlayState();
        return false;
      }

      if (isCaptureNavMessage(message)) {
        // A panel-forwarded keypress — same handler as a local one.
        handleCaptureNavKey(message.key, message.repeat);
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
    // Hover detection — drives preview overlay. The same cursor is
    // ALSO driven by arrow keys (below); `keyboardNavActive` arbitrates
    // (the pattern lifted from Undercurrent's list nav): while the
    // keyboard is driving, hover events don't move the cursor at all —
    // including the synthetic mouseover/mousemove Chrome fires when
    // our own scroll slides the page under a stationary pointer. Only
    // GENUINE pointer movement (coordinates changed) hands control
    // back to the mouse, and then the next hover takes over.
    // ---------------------------------------------------------------
    let hoveredArticle: Element | null = null;
    let keyboardNavActive = false;
    let lastPointerX = -1;
    let lastPointerY = -1;
    // Resume anchor: the last article the cursor occupied, kept when
    // the cursor itself clears (Escape release, the mouse drifting off
    // articles or out of the window). The first arrow press afterwards
    // re-acquires THIS tweet — the user's place — and only the next
    // press moves. Without it the press fell back to the viewport
    // pick, which lands on the partially-visible tweet above/below
    // (field bug: ↓ after a release outlined the tweet ABOVE).
    let lastCursorArticle: Element | null = null;

    document.addEventListener('mousemove', (event) => {
      const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      // Scroll-end synthetic mousemove keeps the old coordinates —
      // only real movement ends keyboard control.
      if (moved && keyboardNavActive) keyboardNavActive = false;
    });

    document.addEventListener('mouseover', (event) => {
      // No mode active or panel closed → no preview, no work to do.
      // The isAlive probe also matters here: an orphaned script
      // (extension reloaded under this page) must not keep painting
      // previews its dead click handler can never act on — probing
      // flips extensionAlive, and the rAF loop tears everything down.
      if (captureMode === 'none' || !panelOpen || !isAlive()) return;
      if (keyboardNavActive) return;
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
        lastCursorArticle = article;
        applyOverlayState();
      }
    });

    document.addEventListener('mouseout', (event) => {
      // Only clear when the mouse leaves the entire document (related
      // target is null). Element-to-element mouseouts inside the
      // document are noisy and the corresponding mouseover handles them.
      if (event.relatedTarget !== null) return;
      // A keyboard-placed cursor is not the mouse's to clear.
      if (keyboardNavActive) return;
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

    // ---------------------------------------------------------------
    // Keyboard navigation — ↑/↓ move the hover cursor, Enter is the
    // click. Active ONLY while a capture mode is on (the same carve as
    // click interception: an explicitly-armed mode changes how input
    // acts on this page, visibly). Hard guards: never while focus is
    // in an editable field, never with modifiers held. At the rendered
    // list's edges the press deliberately passes through — the native
    // scroll makes X's virtualization render more tweets, so the next
    // press continues. Held keys accelerate (1 → 2 → 3 tweets per
    // press; tweets are tall, so the ramp stays gentle).
    // ---------------------------------------------------------------
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      return (
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]',
        ) !== null
      );
    }

    /**
     * Nudge the cursor article into the comfortable band of the
     * viewport — scroll only when it sits within MARGIN of an edge (or
     * off screen), and only BY the overshoot. Mid-viewport steps don't
     * scroll at all; a taller-than-band tweet anchors its top so
     * reading starts at the start. Discrete presses glide (smooth);
     * HELD-key repeats scroll instantly — smooth animation can't keep
     * pace with the repeat rate, and the cursor would escape the
     * viewport (the same reason multi-step acceleration was reverted).
     */
    const SCROLL_MARGIN = 100;
    function nudgeArticleIntoView(article: Element, instant: boolean): void {
      const rect = article.getBoundingClientRect();
      const topBound = SCROLL_MARGIN;
      const bottomBound = window.innerHeight - SCROLL_MARGIN;
      const behavior = instant ? 'auto' : 'smooth';
      if (rect.height > bottomBound - topBound || rect.top < topBound) {
        window.scrollBy({ top: rect.top - topBound, behavior });
      } else if (rect.bottom > bottomBound) {
        window.scrollBy({ top: rect.bottom - bottomBound, behavior });
      }
    }

    /**
     * One nav keypress — from this page's own keydown listener OR
     * forwarded from the panel (`bg:capture-nav`). The forwarding is
     * what makes the keys live the moment the hover outline appears:
     * keystrokes land in the FOCUSED document, which right after
     * arming the mode is the panel, not this page. Returns whether
     * the key was consumed (the local listener translates that into
     * preventDefault; an unconsumed arrow at the rendered edge
     * deliberately scrolls natively so virtualization renders more).
     */
    function handleCaptureNavKey(key: CaptureNavKey, repeat: boolean): boolean {
      if (captureMode === 'none' || !panelOpen) return false;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        // The keyboard takes the cursor even when the step itself
        // can't move (edge): the suppression must already hold when
        // the passed-through native scroll fires echo mouseovers.
        keyboardNavActive = true;
        let cursor = hoveredArticle !== null && hoveredArticle.isConnected ? hoveredArticle : null;
        if (cursor === null && currentLockTargetStillValid(lastCursorArticle)) {
          // No cursor but a remembered place — the first press brings
          // back the tweet the user was on (release/drift cleared it);
          // the NEXT press is the one that moves. (The validity check
          // is the generic connected-and-in-active-layer predicate.)
          hoveredArticle = lastCursorArticle;
          applyOverlayState();
          nudgeArticleIntoView(lastCursorArticle, repeat);
          return true;
        }
        if (cursor === null && captureMode === 'reply-context') {
          // Nav resumes from the current selection — the locked
          // tweet — when it's rendered, rather than the viewport.
          cursor = findLockArticle(isXModalOpen() ? 'modal' : 'page');
        }
        const next = stepToAdjacentArticle(cursor, key === 'ArrowDown' ? 1 : -1);
        if (next === null) return false;
        hoveredArticle = next;
        lastCursorArticle = next;
        applyOverlayState();
        nudgeArticleIntoView(next, repeat);
        return true;
      }
      if (key === 'Enter') {
        if (hoveredArticle === null || !hoveredArticle.isConnected) return false;
        if (captureMode === 'library') {
          runLibraryCapture(hoveredArticle);
        } else {
          runReplyContextSelect(hoveredArticle);
        }
        return true;
      }
      // Escape — staged de-select: drop the VISIBLE cursor first, the
      // reply-context lock next. Visibility is the stage gate: after
      // Enter locks a tweet the cursor still points at it, but its
      // preview is suppressed (hovered === locked paints nothing), and
      // a press that clears only an invisible cursor reads as a dead
      // key — that exact double-press was a field bug. While X has a
      // modal open, Escape is X's (it closes the modal).
      if (isXModalOpen()) return false;
      const lockTarget = captureMode === 'reply-context' ? findLockArticle('page') : null;
      const cursorVisible =
        hoveredArticle !== null && hoveredArticle.isConnected && hoveredArticle !== lockTarget;
      if (cursorVisible) {
        hoveredArticle = null;
        keyboardNavActive = false;
        applyOverlayState();
        return true;
      }
      if (captureMode === 'reply-context' && replyContextLock !== null) {
        // Clear the stale/invisible cursor along with the lock.
        hoveredArticle = null;
        keyboardNavActive = false;
        dismissReplyContext();
        return true;
      }
      return false;
    }

    document.addEventListener(
      'keydown',
      (event) => {
        if (!isAlive()) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.isComposing) return;
        const key = event.key;
        if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== 'Escape') {
          return;
        }
        if (isEditableTarget(event.target)) return;
        if (handleCaptureNavKey(key, event.repeat)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { capture: true },
    );

    function runLibraryCapture(article: Element): void {
      try {
        // Thread capture (Phase 10): on a /status/ page the click may
        // sit on a self-reply spine — if the visible chain is ≥2, the
        // whole thread saves as one item. Any truncated segment blocks
        // (we only save full text; expand on X and re-capture); a
        // spine of one falls through to the single path, byte-for-byte.
        const spine = collectSelfThreadSpine(article);
        if (spine.length >= 2) {
          const truncatedOrdinals = spine.flatMap((segment, index) =>
            isTweetTruncated(segment) ? [index + 1] : [],
          );
          if (truncatedOrdinals.length > 0) {
            sendOneWay({ type: 'content:capture-failed', reason: 'truncated', truncatedOrdinals });
            return;
          }
          const thread = extractThread(spine);
          if (thread === 'missing-text' || thread === 'missing-author' || thread === 'media-only') {
            sendOneWay({ type: 'content:capture-failed', reason: thread });
            return;
          }
          sendOneWay({ type: 'content:captured-thread', payload: thread });
          return;
        }
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
        // Orphaned script (the extension was reloaded under this
        // page): messaging is dead, so a half-alive UI — hovers
        // painting, clicks inert — is the worst presentation. Take
        // every overlay down and stop for good; a page reload brings
        // the fresh script (§6: overlays disappear on teardown). The
        // flag flips on any isAlive() probe (hover, click, panel-state
        // refresh).
        if (!extensionAlive) {
          window.clearInterval(panelLease);
          overlay.destroy();
          return; // deliberately do not re-arm the loop
        }

        // SPA navigation (X is a single-page app — pushState, no page
        // load): refresh promptly so the highlight vanishes with the
        // old view and re-attaches only where the new view renders the
        // locked tweet.
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

            // The page's light/dark can change on SPA navigation or an
            // X theme switch — keep the overlay's fill in tune.
            overlay.refreshScheme();

            const modalNow = isXModalOpen();
            if (modalNow !== xModalOpen) {
              xModalOpen = modalNow;
              applyOverlayState();
            }

            // Re-find the lock article (modal open → modal scope;
            // otherwise page scope). findLockArticle tries the status
            // id then text identity, so the highlight follows the lock
            // into a modal that re-renders the same tweet and back out
            // again. When both searches miss, the highlight hides —
            // unless the current target is still valid in the active
            // layer. Storage is preserved either way so generation can
            // still use the context.
            if (captureMode === 'reply-context' && replyContextLock !== null) {
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

function isCaptureNavMessage(
  value: unknown,
): value is { type: 'bg:capture-nav'; key: CaptureNavKey; repeat: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown; key?: unknown; repeat?: unknown };
  return (
    v.type === 'bg:capture-nav' &&
    (v.key === 'ArrowUp' || v.key === 'ArrowDown' || v.key === 'Enter' || v.key === 'Escape') &&
    typeof v.repeat === 'boolean'
  );
}
