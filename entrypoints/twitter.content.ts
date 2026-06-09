/**
 * Content script that runs on X.com / twitter.com pages.
 *
 * Job: while the user has capture mode on, intercept clicks on tweet
 * articles, extract their text and metadata, and forward the raw capture
 * to the background worker. The background validates the author and
 * decides whether to persist.
 *
 * Security invariants (CLAUDE.md §6):
 *   - Never reads or holds the API key.
 *   - Never writes to X's DOM and never auto-posts.
 *   - All contact with the page is read-only and degrades gracefully
 *     when X's markup changes — extraction failures report a clear
 *     reason rather than guessing or throwing.
 *
 * X's markup is a moving target. We anchor on `data-testid` hooks
 * (the most stable surface available); when those drift, the user sees
 * a clean fallback message in the panel and can use the manual-paste
 * path instead.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendOneWay } from '../src/messaging';
import type { RawCapture } from '../src/types/capture';
import type { ReplyContext } from '../src/types';

export default defineContentScript({
  matches: [
    'https://x.com/*',
    'https://www.x.com/*',
    'https://twitter.com/*',
    'https://www.twitter.com/*',
  ],
  runAt: 'document_idle',
  main() {
    let captureActive = false;

    // True once the extension has been reloaded since this script was
    // injected. Chrome leaves the orphaned content script attached to
    // the page until the user refreshes the tab; any `chrome.runtime.*`
    // call from here will throw "Extension context invalidated."
    // We flip this flag the first time we observe such a throw and
    // make the click handler / message listener no-ops afterwards.
    let extensionAlive = true;
    const isAlive = (): boolean => {
      if (!extensionAlive) return false;
      // `chrome.runtime?.id` reads as undefined once the runtime has
      // been torn down — a synchronous, throw-free probe.
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

    // Capture-mode lives in `chrome.storage.session`, which the content
    // script cannot read directly (kept trusted-only so the user's
    // "Session only" API-key choice stays isolated). Instead we ask the
    // background for the current value on load and listen for pushes.
    try {
      chrome.runtime
        .sendMessage({ type: 'content:check-capture-mode' })
        .then((reply: unknown) => {
          if (isCaptureModeState(reply)) captureActive = reply.active;
        })
        .catch(() => {
          // Background may briefly be unresponsive at startup; the next
          // push (or a click-driven mismatch) will recover.
        });
    } catch {
      // Orphaned content script from a previous extension reload.
      extensionAlive = false;
    }

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isAlive()) return false;
      if (isCaptureModeState(message)) {
        captureActive = message.active;
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

    document.addEventListener(
      'click',
      (event) => {
        if (!captureActive) return;
        // Silently bail when the runtime has been torn down by an
        // extension reload. The user will see new captures work again
        // after they refresh the x.com tab.
        if (!isAlive()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;

        const article = target.closest('article[data-testid="tweet"]');
        if (!article) {
          // Click landed somewhere other than a tweet (sidebar, header,
          // composer). Let X's own UI handle it.
          return;
        }

        // Let X handle clicks on interactive controls inside the
        // article — Show more, action buttons (Reply / Retweet / Like /
        // etc.), and embedded links (@-mentions, hashtags, URLs). Only
        // clicks on inert tweet body content trigger capture. This is
        // what makes "Show more then click to capture" work in a single
        // session of capture mode rather than requiring a toggle dance.
        if (target.closest('button, a, [role="button"], [role="link"]')) {
          return;
        }

        // From here on, the click belongs to us. Stop X from navigating.
        event.preventDefault();
        event.stopPropagation();

        runCapture(article);
      },
      { capture: true },
    );

    function runCapture(article: Element): void {
      try {
        // Refuse to capture a tweet X is currently truncating. The
        // alternative is saving the visible preview, which silently
        // shortens the user's voice library — worse than asking the
        // user to expand the tweet first. See the doc on
        // `isTweetTruncated` for why we can't auto-expand.
        if (isTweetTruncated(article)) {
          sendOneWay({ type: 'content:capture-failed', reason: 'truncated' });
          return;
        }

        const capture = extractTweet(article);
        if (capture === 'missing-text' || capture === 'missing-author') {
          sendOneWay({ type: 'content:capture-failed', reason: capture });
          return;
        }
        sendOneWay({ type: 'content:captured-tweet', payload: capture });
      } catch {
        // Defence in depth: an unexpected DOM shape should never throw
        // back into the page. Surface a graceful failure instead.
        sendOneWay({ type: 'content:capture-failed', reason: 'unknown' });
      }
    }
  },
});

function isCaptureModeState(
  value: unknown,
): value is { type: 'bg:capture-mode-state'; active: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'bg:capture-mode-state' &&
    typeof (value as { active?: unknown }).active === 'boolean'
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

/**
 * Scrape the reply target (and one parent up, if visible) from around
 * X's open composer. Read-only — never touches the DOM.
 *
 * Two layout cases X uses:
 *   - Modal reply (Reply from a feed/profile): composer + target render
 *     inside `[role="dialog"]`. We scope to the dialog so we don't
 *     accidentally grab the timeline behind it.
 *   - Inline reply (composer at the bottom of a status detail page):
 *     no dialog; the target lives in the page itself, above the
 *     composer in DOM order.
 *
 * Returns:
 *   - `null` when no composer is open (precondition the caller checks).
 *   - `{ error }` when a composer is open but we can't find a target.
 *   - `ReplyContext` on success. `grandparentText` may be null when the
 *     target is itself a top-level post (or only one tweet is visible).
 */
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
    grandparentText,
    hadUnreadableMedia: hasMedia(target) || (grandparent !== null && hasMedia(grandparent)),
  };
}

/** Best-effort detection of media on a tweet. Used to surface the
 *  text-only v1 limitation; never blocks capture. */
function hasMedia(article: Element): boolean {
  if (article.querySelector('[data-testid="tweetPhoto"]')) return true;
  if (article.querySelector('[data-testid="videoComponent"]')) return true;
  if (article.querySelector('[data-testid="card.wrapper"]')) return true;
  if (article.querySelector('[data-testid="card.layoutLarge.media"]')) return true;
  return false;
}

/**
 * Pull a `RawCapture` out of a tweet `<article>`. Returns a failure
 * reason string when a required field can't be read. Pure DOM read —
 * never mutates the page.
 */
function extractTweet(
  article: Element,
): RawCapture | 'missing-text' | 'missing-author' {
  const textRoot = article.querySelector('[data-testid="tweetText"]');
  if (!textRoot) return 'missing-text';

  const text = readVisibleText(textRoot).trim();
  if (text === '') return 'missing-text';

  const authorHandle = readAuthorHandle(article);
  if (authorHandle === null || authorHandle === '') return 'missing-author';

  return {
    text,
    authorHandle,
    statusId: readStatusId(article),
    timestamp: readTimestamp(article),
    hasReplyContextNode: detectReplyContext(article),
    inReplyToStatusId: null,
    isPrecededByParentArticle: detectReplyByDomStructure(article),
  };
}

/**
 * Decide whether the captured article is a reply (vs a standalone
 * post) based on the surrounding DOM. Two layouts X uses:
 *
 *   1. Feed views (home, profile, /with_replies). Each tweet lives in
 *      its own `cellInnerDiv`. X separates unrelated tweets with an
 *      empty cellInnerDiv spacer; threads have either the parent tweet
 *      OR a "Show more replies" toggle in the previous cell instead.
 *
 *   2. Status detail pages (`/handle/status/<id>`). Every article in
 *      the conversation EXCEPT the focal tweet is by definition a
 *      reply, regardless of author — the page IS a reply thread. The
 *      focal tweet itself is a reply when X shows parent context above
 *      it (it has its own parent rendered as an article above).
 *
 * Self-thread continuations are classified as reply on both layouts.
 * Per the Chunk-2 spec they're stylistically closer to replies than
 * standalone posts; the user can override per-item if they disagree.
 *
 * Limitation: the "Show more replies" / "Show this thread" separator
 * recognition is English-only. Localised UIs may classify a thread
 * continuation that sits below the separator as post until the user
 * overrides. The structural cellInnerDiv check still handles the
 * common cases regardless of language.
 */
function detectReplyByDomStructure(article: Element): boolean {
  // Branch 1: status detail page.
  const statusMatch = /^\/[^/]+\/status\/(\d+)/.exec(window.location.pathname);
  if (statusMatch) {
    const urlStatusId = statusMatch[1];
    const articleStatusId = readStatusId(article);
    if (articleStatusId !== null && articleStatusId !== urlStatusId) {
      // Some other tweet in the focal conversation — reply, by
      // definition (it's either parent-context-above or a response).
      return true;
    }
    // Article IS the focal tweet (or status id unreadable). It's a
    // reply when X is rendering parent context above it.
    const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    return allArticles.indexOf(article) > 0;
  }

  // Branch 2: feed views.
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return false;
  const prevCell = cell.previousElementSibling;
  if (!prevCell) return false;
  if (prevCell.querySelector('article[data-testid="tweet"]')) return true;
  const sep = prevCell.textContent?.trim() ?? '';
  return sep === 'Show more replies' || sep === 'Show this thread';
}

/**
 * X renders emoji as `<img alt="🎉">`. Plain `.textContent` would drop
 * the alt text and lose every emoji. Walk the tree and substitute
 * `alt` for image nodes so the captured text matches what the user sees.
 */
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

/**
 * The author handle lives in `[data-testid="User-Name"]`. It has several
 * anchor children (display name, @handle). We want the one whose href
 * is exactly `/handle` (no `/status/`, no `/photo/`). That pattern is
 * what X uses for the handle link and skips the display-name anchor
 * which shares the same href.
 */
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

/**
 * The permalink anchor wraps the `<time>` element. Its href is
 * `/{handle}/status/{id}`. Return the id when found, else null.
 */
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
 * Best-effort reply detection. X renders a "Replying to @x" snippet
 * above replies; there is no stable testid on that block today, so we
 * fall back to a text scan of the whole article. The false-positive
 * case (a tweet that literally contains "Replying to" in its body) is
 * rare, and the Voice tab lets the user override the type. Localising
 * this is a Chunk-5 polish concern.
 */
function detectReplyContext(article: Element): boolean {
  const text = article.textContent ?? '';
  return /\bReplying to\b/i.test(text);
}

/**
 * True if X has truncated this tweet (a "Show more" toggle is present
 * inside the article). Used to refuse capture rather than silently
 * saving the visible preview.
 *
 * Why we don't auto-click Show more: empirically verified that X's
 * handler is gated on `event.isTrusted === true`, which is set only
 * by the browser for real user input. JavaScript-dispatched events
 * — including a full pointerover → pointerdown → pointerup → click
 * sequence with authentic coordinates — never satisfy that check.
 * The only way to dispatch a trusted event from an extension is
 * `chrome.debugger.attach()` / DevTools Protocol, which requires the
 * `debugger` permission. That permission gives the extension full
 * DOM/JS control over the tab — far more than this extension wants
 * to ask for or users should grant. We document the limitation in
 * the README roadmap and ask the user to click Show more themselves.
 */
function isTweetTruncated(article: Element): boolean {
  if (article.querySelector('[data-testid="tweet-text-show-more-link"]')) return true;
  // Fallback when the testid drifts: an exact-text "Show more" toggle.
  // Strict equality so we never match "Show this thread" etc.
  const candidates = article.querySelectorAll('button, [role="button"], a[role="link"]');
  for (const c of Array.from(candidates)) {
    if (c.textContent?.trim() === 'Show more') return true;
  }
  return false;
}
