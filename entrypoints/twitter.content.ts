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
 *   - A single capture-mode value (`'none' | 'library' | 'reply-context'`)
 *     drives click behavior + overlay visibility.
 *   - A reply-context lock (`ReplyContext | null`) drives the locked
 *     highlight overlay, persisting across scroll on the current page
 *     and clearing on navigation, dismiss, or replacement.
 *   - Both pieces of state live in the background's chrome.storage.session
 *     and are mirrored here via the typed messaging layer.
 *
 * X's markup is a moving target. We anchor on `data-testid` hooks (the
 * most stable surface available); when those drift, the user sees a
 * clean fallback rather than a broken extension.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendOneWay } from '../src/messaging';
import type { RawCapture } from '../src/types/capture';
import type { ReplyContext } from '../src/types';
import type { ActiveCaptureMode } from '../src/storage/captureMode';

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
        captureMode === 'reply-context' &&
        replyContextLock &&
        replyContextLock.targetStatusId
          ? findArticleByStatusId(replyContextLock.targetStatusId)
          : null;
      overlay.setLock(lockArticle);

      // Preview is suppressed when hovering the locked article so we
      // don't paint two overlays on the same tweet.
      const showPreview =
        captureMode !== 'none' &&
        hoveredArticle !== null &&
        hoveredArticle !== lockArticle;
      overlay.setPreview(showPreview ? hoveredArticle : null);
    }

    // ---------------------------------------------------------------
    // State pushes / requests
    // ---------------------------------------------------------------
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
    // scroll remount). The same loop watches the URL: when the path
    // changes from where the lock was set, we clear the lock.
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
      overlay.destroy();
    });
  },
});

// =====================================================================
// Type guards
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

// =====================================================================
// Tweet extraction (existing logic preserved)
// =====================================================================

function extractTweet(
  article: Element,
): RawCapture | 'missing-text' | 'missing-author' | 'media-only' {
  const textRoot = article.querySelector('[data-testid="tweetText"]');
  const articleHasMedia = hasMedia(article);
  if (!textRoot) {
    // No text content found. If the article does contain media, this
    // is a media-only post (which can't enter a text-only corpus);
    // otherwise X probably changed its markup.
    return articleHasMedia ? 'media-only' : 'missing-text';
  }

  const text = readVisibleText(textRoot).trim();
  if (text === '') {
    return articleHasMedia ? 'media-only' : 'missing-text';
  }

  const authorHandle = readAuthorHandle(article);
  if (authorHandle === null || authorHandle === '') return 'missing-author';

  return {
    text,
    authorHandle,
    authorDisplayName: readDisplayName(article),
    authorAvatarUrl: readAvatarUrl(article),
    statusId: readStatusId(article),
    timestamp: readTimestamp(article),
    hasReplyContextNode: detectReplyContext(article),
    inReplyToStatusId: null,
    isPrecededByParentArticle: detectReplyByDomStructure(article),
    hasMedia: articleHasMedia,
  };
}

/**
 * Extract a ReplyContext from a SPECIFIC article (the one the user
 * clicked to select), as opposed to the composer-based extractor used
 * by the deprecated button flow.
 *
 * Target = the clicked article.
 * Grandparent = the article in the previous cellInnerDiv, if any (same
 * heuristic the reply-detection structural signal uses).
 */
function extractReplyContextFromArticle(
  article: Element,
): ReplyContext | { error: string } {
  const textRoot = article.querySelector('[data-testid="tweetText"]');
  if (!textRoot) {
    return { error: 'Could not read that tweet — X may have changed its markup.' };
  }
  const targetText = readVisibleText(textRoot).trim();
  if (targetText === '') {
    return { error: 'The target tweet is text-empty (or media-only — see the v1 limitation).' };
  }

  const grandparentArticle = findGrandparentArticle(article);
  let grandparentText: string | null = null;
  if (grandparentArticle) {
    const gpText = grandparentArticle.querySelector('[data-testid="tweetText"]');
    if (gpText) {
      const t = readVisibleText(gpText).trim();
      if (t !== '') grandparentText = t;
    }
  }

  return {
    targetText,
    targetAuthorHandle: readAuthorHandle(article),
    targetAuthorDisplayName: readDisplayName(article),
    targetAuthorAvatarUrl: readAvatarUrl(article),
    targetTimestamp: readTimestamp(article),
    targetStatusId: readStatusId(article),
    grandparentText,
    hadUnreadableMedia:
      hasMedia(article) || (grandparentArticle !== null && hasMedia(grandparentArticle)),
  };
}

/**
 * Find the parent tweet of `article` in the DOM, but only when we're
 * confident the preceding article is actually a thread parent rather
 * than an unrelated tweet in the timeline.
 *
 * Confidence sources (the contexts where X reliably renders parent
 * context directly above a tweet):
 *   - Status detail pages (`/handle/status/<id>`): the conversation
 *     view; tweets above the focal are parent context.
 *   - The `/with_replies` feed: X separates unrelated conversations
 *     with empty cellInnerDiv spacers, so a non-empty previous cell
 *     containing a tweet IS the parent.
 *
 * Other contexts — profile timelines (`/handle`), the home feed,
 * search results, lists — X renders unrelated tweets stacked directly
 * without spacers, so a previous-cell tweet is NOT necessarily the
 * parent. We skip grandparent capture there rather than guess wrong.
 * The user can hand-write the parent context into bullets if it matters.
 */
function findGrandparentArticle(article: Element): Element | null {
  const path = window.location.pathname;
  const onStatusDetail = /^\/[^/]+\/status\/\d+/.test(path);
  const onRepliesFeed = /\/with_replies\/?$/.test(path);
  if (!onStatusDetail && !onRepliesFeed) return null;

  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return null;
  const prevCell = cell.previousElementSibling;
  if (!prevCell) return null;
  return prevCell.querySelector('article[data-testid="tweet"]');
}

function findArticleByStatusId(statusId: string): Element | null {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const a of Array.from(articles)) {
    if (readStatusId(a) === statusId) return a;
  }
  return null;
}

function detectReplyByDomStructure(article: Element): boolean {
  const statusMatch = /^\/[^/]+\/status\/(\d+)/.exec(window.location.pathname);
  if (statusMatch) {
    const urlStatusId = statusMatch[1];
    const articleStatusId = readStatusId(article);
    if (articleStatusId !== null && articleStatusId !== urlStatusId) {
      return true;
    }
    const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    return allArticles.indexOf(article) > 0;
  }
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return false;
  const prevCell = cell.previousElementSibling;
  if (!prevCell) return false;
  if (prevCell.querySelector('article[data-testid="tweet"]')) return true;
  const sep = prevCell.textContent?.trim() ?? '';
  return sep === 'Show more replies' || sep === 'Show this thread';
}

function readVisibleText(root: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
    } else if (node instanceof Element) {
      if (node.tagName === 'IMG') {
        parts.push(node.getAttribute('alt') ?? '');
      } else {
        parts.push(readVisibleText(node));
      }
    }
  }
  return parts.join('');
}

function readAuthorHandle(article: Element): string | null {
  const header = article.querySelector('[data-testid="User-Name"]');
  if (!header) return null;
  const anchors = header.querySelectorAll('a[href^="/"]');
  for (const anchor of Array.from(anchors)) {
    const href = anchor.getAttribute('href') ?? '';
    const match = /^\/([A-Za-z0-9_]+)$/.exec(href);
    if (match && match[1]) return match[1];
  }
  return null;
}

function readStatusId(article: Element): string | null {
  const anchor = article.querySelector('a[href*="/status/"]');
  if (!anchor) return null;
  const href = anchor.getAttribute('href') ?? '';
  const match = /\/status\/(\d+)/.exec(href);
  return match && match[1] ? match[1] : null;
}

function readTimestamp(article: Element): string | null {
  const time = article.querySelector('time[datetime]');
  return time?.getAttribute('datetime') ?? null;
}

/**
 * Read X's display name out of the User-Name header. The structure is
 * roughly: `[User-Name] > [name-row link href="/handle"] > spans of name`
 * + `[handle-row link href="/handle"] > "@handle"`. Both links point to
 * the same `/handle` href, so we disambiguate by the leading "@".
 */
function readDisplayName(article: Element): string | null {
  const header = article.querySelector('[data-testid="User-Name"]');
  if (!header) return null;
  const anchors = header.querySelectorAll('a[href^="/"]');
  for (const anchor of Array.from(anchors)) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^\/[A-Za-z0-9_]+$/.test(href)) continue;
    const text = readVisibleText(anchor).trim();
    if (text === '' || text.startsWith('@')) continue;
    return text;
  }
  return null;
}

/**
 * Read the author's avatar URL. X renders avatars via `<img>` inside
 * `[data-testid="Tweet-User-Avatar"]`; we only accept `pbs.twimg.com`
 * sources to keep CLAUDE.md §6's image carve-out tight.
 */
function readAvatarUrl(article: Element): string | null {
  const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
  if (!avatar) return null;
  const img = avatar.querySelector('img');
  if (!img) return null;
  const src = img.getAttribute('src') ?? '';
  if (!/^https:\/\/pbs\.twimg\.com\//.test(src)) return null;
  return src;
}

function detectReplyContext(article: Element): boolean {
  const text = article.textContent ?? '';
  return /\bReplying to\b/i.test(text);
}

function isTweetTruncated(article: Element): boolean {
  if (article.querySelector('[data-testid="tweet-text-show-more-link"]')) return true;
  const candidates = article.querySelectorAll('button, [role="button"], a[role="link"]');
  for (const c of Array.from(candidates)) {
    if (c.textContent?.trim() === 'Show more') return true;
  }
  return false;
}

// =====================================================================
// Composer-based reply-context capture (legacy keyboard-shortcut path)
// =====================================================================

function extractReplyContextFromComposer():
  | ReplyContext
  | { error: string }
  | null {
  const composer = document.querySelector('[data-testid^="tweetTextarea_"]');
  if (!composer) return null;

  const dialog = composer.closest('[role="dialog"]');
  const scope: ParentNode = dialog ?? document;

  const articles = Array.from(scope.querySelectorAll('article[data-testid="tweet"]')).filter(
    (a) => composer.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  if (articles.length === 0) {
    return {
      error:
        'Could not find the tweet you are replying to. X may have changed its markup or the composer scrolled off.',
    };
  }

  const target = articles[articles.length - 1];
  if (!target) {
    return { error: 'Could not isolate the target tweet near the composer.' };
  }
  const grandparent: Element | null =
    articles.length > 1 ? (articles[articles.length - 2] ?? null) : null;

  const targetTextRoot = target.querySelector('[data-testid="tweetText"]');
  const targetText = targetTextRoot ? readVisibleText(targetTextRoot).trim() : '';
  if (targetText === '') {
    return { error: 'The target tweet is text-empty (or media-only — see the v1 limitation).' };
  }

  const grandparentText = (() => {
    if (!grandparent) return null;
    const root = grandparent.querySelector('[data-testid="tweetText"]');
    if (!root) return null;
    const t = readVisibleText(root).trim();
    return t === '' ? null : t;
  })();

  return {
    targetText,
    targetAuthorHandle: readAuthorHandle(target),
    targetAuthorDisplayName: readDisplayName(target),
    targetAuthorAvatarUrl: readAvatarUrl(target),
    targetTimestamp: readTimestamp(target),
    targetStatusId: readStatusId(target),
    grandparentText,
    hadUnreadableMedia: hasMedia(target) || (grandparent !== null && hasMedia(grandparent)),
  };
}

function hasMedia(article: Element): boolean {
  if (article.querySelector('[data-testid="tweetPhoto"]')) return true;
  if (article.querySelector('[data-testid="videoComponent"]')) return true;
  if (article.querySelector('[data-testid="card.wrapper"]')) return true;
  if (article.querySelector('[data-testid="card.layoutLarge.media"]')) return true;
  return false;
}

// =====================================================================
// Overlay system
//
// Two overlay states:
//   - preview: outline-only highlight that follows the hovered tweet
//     while a capture mode is active. No fill, no controls.
//   - lock:    outline + tinted fill on the captured reply-context
//     tweet, with a dismiss control and a label below. Persists across
//     scrolls; cleared on dismiss, mode-off, or SPA navigation.
//
// Per the §6 carve-out (see CLAUDE.md):
//   - All overlay elements carry `data-margin-overlay` for easy audit.
//   - All visuals are `pointer-events: none`. The dismiss control is
//     the ONLY interactive child; it only clears extension-side state.
//   - We never annotate X's own elements.
// =====================================================================

interface OverlaySystem {
  setPreview(article: Element | null): void;
  setLock(article: Element | null): void;
  getLockTarget(): Element | null;
  reposition(): void;
  destroy(): void;
}

function createOverlaySystem(opts: { onDismiss: () => void }): OverlaySystem {
  injectOverlayStyles();

  const root = document.createElement('div');
  root.setAttribute('data-margin-overlay', 'root');
  root.style.position = 'fixed';
  root.style.top = '0';
  root.style.left = '0';
  root.style.width = '0';
  root.style.height = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483000';
  document.body.appendChild(root);

  const previewEl = buildOverlayElement('preview');
  const lockEl = buildOverlayElement('lock');
  const dismissBtn = document.createElement('button');
  dismissBtn.setAttribute('data-margin-overlay', 'dismiss');
  dismissBtn.setAttribute('type', 'button');
  dismissBtn.setAttribute('aria-label', 'Clear reply context');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onDismiss();
  });
  lockEl.appendChild(dismissBtn);

  const labelEl = document.createElement('div');
  labelEl.setAttribute('data-margin-overlay', 'label');
  labelEl.textContent = '↑ pulled in as reply context';

  root.appendChild(previewEl);
  root.appendChild(lockEl);
  root.appendChild(labelEl);

  let previewTarget: Element | null = null;
  let lockTarget: Element | null = null;
  // Cache the last-applied rect per overlay element. The rAF loop calls
  // `reposition` every frame; without this cache, every frame writes
  // identical `style.top/left` values which interrupts the CSS
  // transition (each style write is treated as a new target). With the
  // cache, the transition only kicks off when the rect actually moves.
  const cachedRects = new WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>();

  function setPreview(article: Element | null): void {
    const changed = article !== previewTarget;
    previewTarget = article;
    if (!article) {
      previewEl.style.display = 'none';
      return;
    }
    previewEl.style.display = 'block';
    if (changed) animateOnce(previewEl);
    positionElement(previewEl, article.getBoundingClientRect(), cachedRects);
  }

  function setLock(article: Element | null): void {
    const changed = article !== lockTarget;
    lockTarget = article;
    const visible = article !== null;
    lockEl.style.display = visible ? 'block' : 'none';
    labelEl.style.display = visible ? 'block' : 'none';
    if (article) {
      if (changed) {
        animateOnce(lockEl);
        animateOnce(labelEl);
      }
      const rect = article.getBoundingClientRect();
      positionElement(lockEl, rect, cachedRects);
      positionLabel(labelEl, rect, cachedRects);
    }
  }

  /**
   * Add the `.moving` class briefly so CSS transitions apply during a
   * target change, then remove it so subsequent per-frame scroll
   * updates skip the transition (and thus stay perfectly in sync with
   * the cursor's scroll position rather than lagging by the animation
   * duration). 250 ms covers the 160 ms transition with a buffer.
   */
  function animateOnce(el: HTMLElement): void {
    el.classList.add('moving');
    // Long enough to cover the 0.16s lock transition. Preview's 0.08s
    // also fits comfortably under this ceiling.
    window.setTimeout(() => el.classList.remove('moving'), 220);
  }

  function reposition(): void {
    if (previewTarget && previewEl.style.display !== 'none') {
      positionElement(previewEl, previewTarget.getBoundingClientRect(), cachedRects);
    }
    if (lockTarget && lockEl.style.display !== 'none') {
      const rect = lockTarget.getBoundingClientRect();
      positionElement(lockEl, rect, cachedRects);
      positionLabel(labelEl, rect, cachedRects);
    }
  }

  function destroy(): void {
    root.remove();
  }

  return {
    setPreview,
    setLock,
    getLockTarget: () => lockTarget,
    reposition,
    destroy,
  };
}

function buildOverlayElement(kind: 'preview' | 'lock'): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('data-margin-overlay', kind);
  el.style.position = 'fixed';
  el.style.boxSizing = 'border-box';
  el.style.pointerEvents = 'none';
  el.style.display = 'none';
  return el;
}

function positionElement(
  el: HTMLElement,
  rect: DOMRect,
  cache: WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>,
): void {
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const last = cache.get(el);
  if (last && last.x === x && last.y === y && last.w === w && last.h === h) return;
  el.style.top = `${String(y)}px`;
  el.style.left = `${String(x)}px`;
  el.style.width = `${String(w)}px`;
  el.style.height = `${String(h)}px`;
  cache.set(el, { x, y, w, h });
}

function positionLabel(
  el: HTMLElement,
  rect: DOMRect,
  cache: WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>,
): void {
  // Label anchors to the bottom-left of the lock highlight, just below
  // the rectangle. Vertical offset of 4px keeps it visually attached
  // to the bottom border without overlapping it. Width/height aren't
  // applied because the label sizes to its content (the pill style).
  const x = Math.round(rect.left + 8);
  const y = Math.round(rect.bottom + 4);
  const last = cache.get(el);
  if (last && last.x === x && last.y === y) return;
  el.style.top = `${String(y)}px`;
  el.style.left = `${String(x)}px`;
  cache.set(el, { x, y, w: 0, h: 0 });
}

let stylesInjected = false;
function injectOverlayStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-margin-overlay', 'styles');
  // Define the overlay's own colour scope rather than reading the
  // panel's `[data-theme]` token (X.com is its own document and we
  // can't reach the panel's CSS variables from here). Two colour
  // schemes: an oklch muted-blue that matches the panel's accent in
  // light theme, and a slightly brighter variant for users browsing
  // X in dark mode. We auto-detect via `prefers-color-scheme`.
  style.textContent = `
    [data-margin-overlay="root"] {
      --margin-accent: oklch(0.56 0.12 250);
      --margin-accent-fill: oklch(0.56 0.12 250 / 0.08);
      --margin-accent-hover: oklch(0.5 0.13 250);
      --margin-on-accent: oklch(0.99 0.005 250);
    }
    @media (prefers-color-scheme: dark) {
      [data-margin-overlay="root"] {
        --margin-accent: oklch(0.7 0.13 248);
        --margin-accent-fill: oklch(0.7 0.13 248 / 0.10);
        --margin-accent-hover: oklch(0.76 0.13 248);
        --margin-on-accent: oklch(0.15 0.02 250);
      }
    }
    [data-margin-overlay="preview"] {
      border: 2px solid color-mix(in oklab, var(--margin-accent) 70%, transparent);
      border-radius: 16px;
      background: transparent;
    }
    [data-margin-overlay="lock"] {
      border: 2px solid var(--margin-accent);
      border-radius: 16px;
      background: var(--margin-accent-fill);
    }
    [data-margin-overlay="preview"].moving {
      transition: top 0.08s ease-out, left 0.08s ease-out,
                  width 0.08s ease-out, height 0.08s ease-out;
    }
    [data-margin-overlay="lock"].moving {
      transition: top 0.16s ease-out, left 0.16s ease-out,
                  width 0.16s ease-out, height 0.16s ease-out;
    }
    [data-margin-overlay="dismiss"] {
      position: absolute;
      top: -10px;
      right: -10px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 0;
      background: var(--margin-accent);
      color: var(--margin-on-accent);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 0;
    }
    [data-margin-overlay="dismiss"]:hover {
      background: var(--margin-accent-hover);
    }
    [data-margin-overlay="label"] {
      position: fixed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: var(--margin-on-accent);
      background: var(--margin-accent);
      padding: 4px 10px;
      border-radius: 6px;
      pointer-events: none;
      display: none;
      box-shadow: 0 1px 3px oklch(0 0 0 / 0.18);
      white-space: nowrap;
      z-index: 2147483000;
    }
    [data-margin-overlay="label"].moving {
      transition: top 0.16s ease-out, left 0.16s ease-out;
    }
  `;
  document.head.appendChild(style);
}
