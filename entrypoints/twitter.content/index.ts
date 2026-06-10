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
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendOneWay } from '../../src/messaging';
import type { ReplyContext } from '../../src/types';
import type { ActiveCaptureMode } from '../../src/storage/captureMode';
import {
  extractReplyContextFromArticle,
  extractReplyContextFromComposer,
  extractTweet,
  findArticleByStatusId,
  isTweetTruncated,
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

    // (No pathname tracking — the lock is preserved across navigation
    // so the captured ReplyContext remains usable for generation. The
    // on-page highlight naturally disappears when findArticleByStatusId
    // returns null on a page that doesn't render the locked tweet.)

    // ---------------------------------------------------------------
    // Overlay system
    // ---------------------------------------------------------------
    const overlay = createOverlaySystem({
      onDismiss: () => {
        if (!isAlive()) return;
        sendOneWay({ type: 'content:dismiss-reply-context' });
      },
    });

    function applyOverlayState(): void {
      // Suppress every overlay whenever the panel isn't actually open.
      // The user can have a capture mode toggled on and the panel
      // closed (state lives in storage), but visually nothing should
      // appear on x.com without the user being in our UI.
      if (!panelOpen) {
        overlay.setLock(null);
        overlay.setPreview(null);
        return;
      }

      // The lock highlight only renders when reply-context mode is on.
      // The lock itself stays in storage (so the panel can still use
      // the captured context for generation) but the on-page indicator
      // is mode-gated per the user's spec: "turn off capture mode →
      // highlight disappears."
      const lockArticle =
        captureMode === 'reply-context' && replyContextLock && replyContextLock.targetStatusId
          ? findArticleByStatusId(replyContextLock.targetStatusId)
          : null;
      overlay.setLock(lockArticle);

      // Preview is suppressed when hovering the locked article so we
      // don't paint two overlays on the same tweet.
      const showPreview =
        captureMode !== 'none' && hoveredArticle !== null && hoveredArticle !== lockArticle;
      overlay.setPreview(showPreview ? hoveredArticle : null);
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
      } catch {
        sendOneWay({ type: 'content:reply-context-failed', reason: 'unknown' });
      }
    }

    // ---------------------------------------------------------------
    // rAF positioning loop + SPA-navigation watch
    //
    // A single requestAnimationFrame loop keeps overlay positions in
    // sync with their target articles (scroll, layout shifts, virtual-
    // scroll remount).
    //
    // rAF caps work at ~60fps and skips when the tab is hidden.
    // ---------------------------------------------------------------
    let rafId = window.requestAnimationFrame(function tick() {
      try {
        // Re-find the lock article in case X virtual-scroll unmounted +
        // remounted it. Compare to the currently-painted target to
        // avoid redundant work. When the lock is set but the article
        // isn't on this page (e.g. user navigated within X's SPA),
        // findArticleByStatusId returns null and the highlight hides;
        // the lock storage is preserved so generation can still use it.
        if (
          captureMode === 'reply-context' &&
          replyContextLock &&
          replyContextLock.targetStatusId
        ) {
          const fresh = findArticleByStatusId(replyContextLock.targetStatusId);
          if (fresh !== overlay.getLockTarget()) {
            overlay.setLock(fresh);
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
