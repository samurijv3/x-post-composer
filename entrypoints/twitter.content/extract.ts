/**
 * DOM extraction for X.com pages — every function here READS X's tree
 * and returns plain data; none of them write anything (CLAUDE.md §6).
 *
 * X's markup is a moving target. We anchor on `data-testid` hooks (the
 * most stable surface available); when those drift, callers see a null
 * / error value and surface a clean fallback rather than a broken
 * extension. Each helper is exported so fixture tests can pin the
 * specific markup assumption it encodes.
 */
import type { RawCapture } from '../../src/types/capture';
import type { ReplyContext } from '../../src/types';
import { isTruncatedRenderingOf, normalizeTweetText } from '../../src/lib/replyContext';

export function extractTweet(
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
 * clicked to select in reply-context mode).
 *
 * Target = the clicked article.
 * Grandparent = the article in the previous cellInnerDiv, if any (same
 * heuristic the reply-detection structural signal uses).
 */
export function extractReplyContextFromArticle(article: Element): ReplyContext | { error: string } {
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
export function findGrandparentArticle(article: Element): Element | null {
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

/**
 * Find the article for a status id within ONE layer of the page.
 *
 * `scope: 'page'` (the default) skips copies rendered inside X's
 * layered dialogs — the reply pop-up re-renders the tweet being
 * replied to, and locking onto that copy would pin our highlight to
 * the modal. `scope: 'modal'` searches ONLY inside the open
 * `aria-modal` layer, for when the user is deliberately working with
 * the modal's content (selecting the tweet shown in the reply dialog
 * or lightbox). One layer or the other, never both — the caller picks
 * based on whether X has a modal up.
 */
export function findArticleByStatusId(
  statusId: string,
  scope: 'page' | 'modal' = 'page',
): Element | null {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const a of Array.from(articles)) {
    if (!articleInLayer(a, scope)) continue;
    if (readStatusId(a) === statusId) return a;
  }
  return null;
}

/**
 * Find the article rendering the given tweet text within one layer —
 * the identity fallback for copies that carry no /status/ link (X's
 * modal renderings). Text is normalized the same way the same-tweet
 * merge normalizes it (`normalizeTweetText`, lib/replyContext), so
 * "the lock's tweet" means the same thing in both places. A candidate
 * that visibly carries X's "Show more" affordance also matches when
 * its text is a truncated prefix of the wanted text — the modal
 * re-collapses long tweets the user already expanded to capture. More
 * expensive than the id search (reads each article's visible text) —
 * callers try the id first.
 */
export function findArticleByTweetText(
  text: string,
  scope: 'page' | 'modal' = 'page',
): Element | null {
  const wanted = normalizeTweetText(text);
  if (wanted === '') return null;
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const a of Array.from(articles)) {
    if (!articleInLayer(a, scope)) continue;
    const textRoot = a.querySelector('[data-testid="tweetText"]');
    if (!textRoot) continue;
    const visible = readVisibleText(textRoot);
    if (normalizeTweetText(visible) === wanted) return a;
    // Truncation-gated prefix identity: only an article that is
    // actually cut off may match by prefix — a genuinely short tweet
    // must never prefix-steal the highlight.
    if (isTweetTruncated(a) && isTruncatedRenderingOf(text, visible)) return a;
  }
  return null;
}

/** Shared layer filter for the article finders: 'modal' = inside the
 *  open aria-modal layer; 'page' = outside every dialog. */
function articleInLayer(article: Element, scope: 'page' | 'modal'): boolean {
  const inModal = article.closest('[aria-modal="true"]') !== null;
  if (scope === 'modal') return inModal;
  return !inModal && article.closest('[role="dialog"]') === null;
}

/**
 * True while X has a modal layer open (reply dialog, compose box,
 * image lightbox). Anchors on `aria-modal="true"` — the standards-level
 * attribute X sets on true modals; hover cards and dropdown menus don't
 * carry it, so they don't blink the overlays. If X drops the attribute,
 * this returns false and the overlay behaves as before — degrade
 * gracefully, never worse.
 */
export function isXModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function detectReplyByDomStructure(article: Element): boolean {
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

/**
 * Walk a node's children and concatenate what a reader actually sees:
 * text nodes plus the `alt` text of inline images (X renders emoji as
 * <img> elements whose alt is the emoji character).
 */
export function readVisibleText(root: Element): string {
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

export function readAuthorHandle(article: Element): string | null {
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

export function readStatusId(article: Element): string | null {
  const anchor = article.querySelector('a[href*="/status/"]');
  if (!anchor) return null;
  const href = anchor.getAttribute('href') ?? '';
  const match = /\/status\/(\d+)/.exec(href);
  return match && match[1] ? match[1] : null;
}

export function readTimestamp(article: Element): string | null {
  const time = article.querySelector('time[datetime]');
  return time?.getAttribute('datetime') ?? null;
}

/**
 * Read X's display name out of the User-Name header. The structure is
 * roughly: `[User-Name] > [name-row link href="/handle"] > spans of name`
 * + `[handle-row link href="/handle"] > "@handle"`. Both links point to
 * the same `/handle` href, so we disambiguate by the leading "@".
 */
export function readDisplayName(article: Element): string | null {
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
export function readAvatarUrl(article: Element): string | null {
  const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
  if (!avatar) return null;
  const img = avatar.querySelector('img');
  if (!img) return null;
  const src = img.getAttribute('src') ?? '';
  if (!/^https:\/\/pbs\.twimg\.com\//.test(src)) return null;
  return src;
}

export function detectReplyContext(article: Element): boolean {
  const text = article.textContent ?? '';
  return /\bReplying to\b/i.test(text);
}

export function isTweetTruncated(article: Element): boolean {
  if (article.querySelector('[data-testid="tweet-text-show-more-link"]')) return true;
  const candidates = article.querySelectorAll('button, [role="button"], a[role="link"]');
  for (const c of Array.from(candidates)) {
    if (c.textContent?.trim() === 'Show more') return true;
  }
  return false;
}

/**
 * Composer-anchored reply-context extraction: finds the tweet article(s)
 * rendered above X's open reply composer. This is the path behind the
 * Alt-Shift-R keyboard shortcut (`panel:capture-reply-context`); the
 * click-to-select flow uses `extractReplyContextFromArticle` instead.
 */
export function extractReplyContextFromComposer(): ReplyContext | { error: string } | null {
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

export function hasMedia(article: Element): boolean {
  if (article.querySelector('[data-testid="tweetPhoto"]')) return true;
  if (article.querySelector('[data-testid="videoComponent"]')) return true;
  if (article.querySelector('[data-testid="card.wrapper"]')) return true;
  if (article.querySelector('[data-testid="card.layoutLarge.media"]')) return true;
  return false;
}
