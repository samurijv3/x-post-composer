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
import type { RawCapture, RawThreadCapture } from '../../src/types/capture';
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
 * Collect the self-reply SPINE around a clicked tweet on a status
 * detail page (thread capture, roadmap Phase 10).
 *
 * The walk: UP through previous `cellInnerDiv` siblings while each
 * holds an article by the same author (a mid-spine click finds the
 * root), then DOWN from that root collecting the contiguous
 * same-author run. It stops at the first cell without an article or
 * with a foreign author — which is exactly what excludes other
 * people's replies AND the author's own replies-to-replies deeper in
 * the conversation (those always render after some foreign article).
 *
 * A root that is itself a reply (the "Replying to" marker, or a
 * foreign article in the directly-preceding cell) is a THREADED REPLY,
 * not a thread — v1 threads are standalone posts, so the walk degrades
 * to a single capture there.
 *
 * Virtualization caveat: only RENDERED segments exist in the DOM, so
 * a long thread collects what's on screen — the caller reports the
 * honest count. Returns `[article]` (a spine of one) anywhere the walk
 * doesn't apply; never throws into the page.
 */
export function collectSelfThreadSpine(article: Element): Element[] {
  const single = [article];
  if (!/^\/[^/]+\/status\/\d+/.test(window.location.pathname)) return single;
  const author = readAuthorHandle(article);
  if (author === null || author === '') return single;
  const startCell = article.closest('[data-testid="cellInnerDiv"]');
  if (!startCell) return single;

  const articleIn = (cell: Element | null): Element | null =>
    cell?.querySelector('article[data-testid="tweet"]') ?? null;
  const sameAuthorArticle = (cell: Element | null): Element | null => {
    const candidate = articleIn(cell);
    if (!candidate) return null;
    const handle = readAuthorHandle(candidate);
    if (handle === null || handle.toLowerCase() !== author.toLowerCase()) return null;
    return candidate;
  };
  // Conversation pages interleave article-less cells BETWEEN posts —
  // the inline reply composer sits directly under the focal tweet,
  // plus dividers and section headers — so the walk steps to the
  // nearest ARTICLE-BEARING cell rather than the literal sibling
  // (field-found: the strict-sibling walk stopped at the composer and
  // dropped the thread root). The foreign-author check below remains
  // the boundary that keeps other conversations out.
  const stepToArticleCell = (from: Element, dir: 'previous' | 'next'): Element | null => {
    let cell = dir === 'previous' ? from.previousElementSibling : from.nextElementSibling;
    while (cell !== null && articleIn(cell) === null) {
      cell = dir === 'previous' ? cell.previousElementSibling : cell.nextElementSibling;
    }
    return cell;
  };

  // Up to the spine root.
  let rootCell: Element = startCell;
  for (;;) {
    const prev = stepToArticleCell(rootCell, 'previous');
    if (prev === null || sameAuthorArticle(prev) === null) break;
    rootCell = prev;
  }

  // A reply-root means this chain hangs under someone else's tweet:
  // any article-bearing cell above the root is, by construction of the
  // up-walk, a FOREIGN article.
  const rootArticle = sameAuthorArticle(rootCell);
  if (rootArticle === null) return single;
  const foreignParentAbove = stepToArticleCell(rootCell, 'previous') !== null;
  if (detectReplyContext(rootArticle) || foreignParentAbove) return single;

  // Down from the root, collecting the same-author run.
  const spine: Element[] = [rootArticle];
  let cell: Element = rootCell;
  for (;;) {
    const next = stepToArticleCell(cell, 'next');
    const segment = sameAuthorArticle(next);
    if (next === null || segment === null) break;
    spine.push(segment);
    cell = next;
  }
  return spine;
}

/**
 * Read a collected spine into a thread payload. Every segment must
 * carry readable text (the truncation gate runs in the caller, before
 * this); the root article supplies the author fields. Mirrors
 * `extractTweet`'s failure vocabulary.
 */
export function extractThread(
  spine: Element[],
): RawThreadCapture | 'missing-text' | 'missing-author' | 'media-only' {
  const root = spine[0];
  if (root === undefined) return 'missing-text';
  const authorHandle = readAuthorHandle(root);
  if (authorHandle === null || authorHandle === '') return 'missing-author';

  const segments: { text: string; statusId: string | null }[] = [];
  let anyMedia = false;
  for (const article of spine) {
    const articleHasMedia = hasMedia(article);
    anyMedia = anyMedia || articleHasMedia;
    const textRoot = article.querySelector('[data-testid="tweetText"]');
    const text = textRoot ? readVisibleText(textRoot).trim() : '';
    if (text === '') {
      // A media-only segment can't enter a text-only corpus; missing
      // text otherwise means X's markup drifted.
      return articleHasMedia ? 'media-only' : 'missing-text';
    }
    segments.push({ text, statusId: readStatusId(article) });
  }

  return {
    segments,
    authorHandle,
    authorDisplayName: readDisplayName(root),
    authorAvatarUrl: readAvatarUrl(root),
    timestamp: readTimestamp(root),
    hasMedia: anyMedia,
  };
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
    // Truncation-gated prefix identity: only an article that shows
    // evidence of being cut off — the Show-more affordance, or text
    // ending in a truncation ellipsis (modal renderings vary in which
    // they carry) — may match by prefix. A genuinely short tweet must
    // never prefix-steal the highlight.
    const looksTruncated = isTweetTruncated(a) || /(?:…|\.{3})\s*(?:Show more)?\s*$/i.test(visible);
    if (looksTruncated && isTruncatedRenderingOf(text, visible)) return a;
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

/**
 * Position-based reply detection — STATUS DETAIL PAGES ONLY. There,
 * vertical order genuinely encodes the conversation: everything below
 * the focal tweet is a reply, and X omits the textual "Replying to"
 * line because the parent is visually present.
 *
 * On feeds (profile, home, with_replies) this deliberately returns
 * false. A previous branch treated "previous cell holds a tweet" as
 * a parent there, assuming X separates unrelated stream tweets with
 * empty spacer cells — field-falsified 2026-06-12: profile streams
 * render adjacent tweets in adjacent non-empty cells, so every post
 * below the first classified as a reply. On feeds the "Replying to"
 * marker (classifyType signal 1) is the only signal we trust; a
 * paired reply rendered without it classifies as 'post', and the
 * Voice tab override is the recourse for that rarer, milder miss.
 */
export function detectReplyByDomStructure(article: Element): boolean {
  const statusMatch = /^\/[^/]+\/status\/(\d+)/.exec(window.location.pathname);
  if (!statusMatch) return false;
  const urlStatusId = statusMatch[1];
  const articleStatusId = readStatusId(article);
  if (articleStatusId !== null && articleStatusId !== urlStatusId) {
    return true;
  }
  const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return allArticles.indexOf(article) > 0;
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
