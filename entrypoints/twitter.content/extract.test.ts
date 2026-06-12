import { afterEach, describe, expect, it } from 'vitest';
import {
  collectSelfThreadSpine,
  extractThread,
  detectReplyByDomStructure,
  detectReplyContext,
  extractReplyContextFromArticle,
  extractReplyContextFromComposer,
  extractTweet,
  findArticleByStatusId,
  findArticleByTweetText,
  findGrandparentArticle,
  hasMedia,
  isTweetTruncated,
  isXModalOpen,
  readAuthorHandle,
  readAvatarUrl,
  readDisplayName,
  readStatusId,
  readTimestamp,
  readVisibleText,
} from './extract';

/**
 * Fixtures encode the X markup assumptions each extractor depends on
 * (data-testid hooks, header anchor shapes, cellInnerDiv structure).
 * When X drifts and an extractor breaks, the matching fixture test
 * names the assumption that died.
 */
function fromHTML(markup: string): HTMLElement {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const el = doc.body.firstElementChild;
  if (!el) throw new Error('fixture markup produced no element');
  return document.importNode(el, true) as HTMLElement;
}

interface TweetFixture {
  text?: string;
  handle?: string;
  displayName?: string;
  statusId?: string;
  timestamp?: string;
  avatarSrc?: string;
  media?: boolean;
  truncated?: boolean;
  replyingTo?: string;
}

function tweetArticle(opts: TweetFixture = {}): HTMLElement {
  const {
    text = 'hello world',
    handle = 'alice',
    displayName = 'Alice Doe',
    statusId = '111',
    timestamp = '2026-06-01T12:00:00.000Z',
    avatarSrc,
    media = false,
    truncated = false,
    replyingTo,
  } = opts;
  return fromHTML(`<article data-testid="tweet">
    ${avatarSrc ? `<div data-testid="Tweet-User-Avatar"><img src="${avatarSrc}" /></div>` : ''}
    <div data-testid="User-Name">
      <a href="/${handle}"><span>${displayName}</span></a>
      <a href="/${handle}"><span>@${handle}</span></a>
      <a href="/${handle}/status/${statusId}"><time datetime="${timestamp}">Jun 1</time></a>
    </div>
    ${replyingTo ? `<div>Replying to <a href="/${replyingTo}">@${replyingTo}</a></div>` : ''}
    ${text === '' ? '' : `<div data-testid="tweetText"><span>${text}</span></div>`}
    ${media ? '<div data-testid="tweetPhoto"></div>' : ''}
    ${truncated ? '<button>Show more</button>' : ''}
  </article>`);
}

function cell(child: Element | null): HTMLElement {
  const c = fromHTML('<div data-testid="cellInnerDiv"></div>');
  if (child) c.appendChild(child);
  return c;
}

function setPath(path: string): void {
  const w = window as unknown as { happyDOM?: { setURL(url: string): void } };
  if (!w.happyDOM) throw new Error('happy-dom URL control unavailable');
  w.happyDOM.setURL(`https://x.com${path}`);
}

afterEach(() => {
  document.body.replaceChildren();
  setPath('/home');
});

describe('readVisibleText', () => {
  it('concatenates text nodes, nested elements, and emoji <img> alt text', () => {
    const root = fromHTML('<div><span>ship</span> it <img alt="🔥" /><span> today</span></div>');
    expect(readVisibleText(root)).toBe('ship it 🔥 today');
  });

  it('returns empty string for an empty node', () => {
    expect(readVisibleText(fromHTML('<div></div>'))).toBe('');
  });
});

describe('readAuthorHandle', () => {
  it('reads the handle from a /handle anchor in the User-Name header', () => {
    expect(readAuthorHandle(tweetArticle({ handle: 'sam_w' }))).toBe('sam_w');
  });

  it('ignores anchors that are not bare /handle hrefs', () => {
    const article = fromHTML(`<article data-testid="tweet">
      <div data-testid="User-Name"><a href="/alice/status/9"><span>x</span></a></div>
    </article>`);
    expect(readAuthorHandle(article)).toBeNull();
  });

  it('returns null when the User-Name header is missing (markup drift)', () => {
    expect(readAuthorHandle(fromHTML('<article data-testid="tweet"></article>'))).toBeNull();
  });
});

describe('readDisplayName', () => {
  it('returns the display name, skipping the @handle anchor', () => {
    expect(readDisplayName(tweetArticle({ displayName: 'Alice Doe' }))).toBe('Alice Doe');
  });

  it('returns null when only the @handle anchor exists', () => {
    const article = fromHTML(`<article data-testid="tweet">
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
    </article>`);
    expect(readDisplayName(article)).toBeNull();
  });
});

describe('readStatusId / readTimestamp', () => {
  it('reads the status id from the permalink anchor', () => {
    expect(readStatusId(tweetArticle({ statusId: '98765' }))).toBe('98765');
  });

  it('reads the ISO timestamp from the <time> element', () => {
    expect(readTimestamp(tweetArticle({ timestamp: '2026-02-03T04:05:06.000Z' }))).toBe(
      '2026-02-03T04:05:06.000Z',
    );
  });

  it('returns null for both when the nodes are absent', () => {
    const bare = fromHTML('<article data-testid="tweet"></article>');
    expect(readStatusId(bare)).toBeNull();
    expect(readTimestamp(bare)).toBeNull();
  });
});

describe('readAvatarUrl — the §6 image carve-out gate', () => {
  it('accepts pbs.twimg.com sources', () => {
    const src = 'https://pbs.twimg.com/profile_images/1/x.jpg';
    expect(readAvatarUrl(tweetArticle({ avatarSrc: src }))).toBe(src);
  });

  it('REJECTS any other host', () => {
    expect(readAvatarUrl(tweetArticle({ avatarSrc: 'https://evil.example/x.jpg' }))).toBeNull();
    expect(readAvatarUrl(tweetArticle({ avatarSrc: 'http://pbs.twimg.com/x.jpg' }))).toBeNull();
  });

  it('returns null when the avatar node is missing', () => {
    expect(readAvatarUrl(tweetArticle())).toBeNull();
  });
});

describe('detectReplyContext / isTweetTruncated / hasMedia', () => {
  it('detects the "Replying to" marker', () => {
    expect(detectReplyContext(tweetArticle({ replyingTo: 'bob' }))).toBe(true);
    expect(detectReplyContext(tweetArticle())).toBe(false);
  });

  it('detects truncation via the show-more testid or button text', () => {
    expect(isTweetTruncated(tweetArticle({ truncated: true }))).toBe(true);
    const viaTestid = fromHTML(`<article data-testid="tweet">
      <div data-testid="tweet-text-show-more-link"></div>
    </article>`);
    expect(isTweetTruncated(viaTestid)).toBe(true);
    expect(isTweetTruncated(tweetArticle())).toBe(false);
  });

  it('detects each media testid X uses', () => {
    for (const id of ['tweetPhoto', 'videoComponent', 'card.wrapper', 'card.layoutLarge.media']) {
      const article = fromHTML(
        `<article data-testid="tweet"><div data-testid="${id}"></div></article>`,
      );
      expect(hasMedia(article)).toBe(true);
    }
    expect(hasMedia(tweetArticle())).toBe(false);
  });
});

describe('extractTweet', () => {
  it('produces a full RawCapture from a well-formed article', () => {
    const article = tweetArticle({
      text: 'a fine post',
      handle: 'alice',
      displayName: 'Alice Doe',
      statusId: '424242',
      avatarSrc: 'https://pbs.twimg.com/profile_images/1/a.jpg',
    });
    const capture = extractTweet(article);
    expect(capture).toMatchObject({
      text: 'a fine post',
      authorHandle: 'alice',
      authorDisplayName: 'Alice Doe',
      authorAvatarUrl: 'https://pbs.twimg.com/profile_images/1/a.jpg',
      statusId: '424242',
      hasMedia: false,
      inReplyToStatusId: null,
    });
  });

  it('classifies a media article without text as media-only', () => {
    expect(extractTweet(tweetArticle({ text: '', media: true }))).toBe('media-only');
  });

  it('classifies a textless, media-less article as missing-text (markup drift)', () => {
    expect(extractTweet(tweetArticle({ text: '' }))).toBe('missing-text');
  });

  it('reports missing-author when the handle cannot be read', () => {
    const article = fromHTML(`<article data-testid="tweet">
      <div data-testid="tweetText"><span>text but no header</span></div>
    </article>`);
    expect(extractTweet(article)).toBe('missing-author');
  });
});

describe('detectReplyByDomStructure', () => {
  it('on a status page, flags articles whose id differs from the URL id', () => {
    setPath('/alice/status/100');
    const focal = tweetArticle({ statusId: '100' });
    const replyBelow = tweetArticle({ statusId: '200' });
    document.body.append(cell(focal), cell(replyBelow));
    expect(detectReplyByDomStructure(replyBelow)).toBe(true);
  });

  it('on a status page, the focal (first) article is not a reply', () => {
    setPath('/alice/status/100');
    const focal = tweetArticle({ statusId: '100' });
    document.body.append(cell(focal));
    expect(detectReplyByDomStructure(focal)).toBe(false);
  });

  it('on a feed, a tweet whose previous cell holds a tweet is a reply', () => {
    setPath('/alice/with_replies');
    const parent = tweetArticle({ statusId: '1' });
    const child = tweetArticle({ statusId: '2' });
    document.body.append(cell(parent), cell(child));
    expect(detectReplyByDomStructure(child)).toBe(true);
  });

  it('on a feed, an empty spacer cell above means standalone post', () => {
    setPath('/alice/with_replies');
    const post = tweetArticle({ statusId: '3' });
    document.body.append(cell(null), cell(post));
    expect(detectReplyByDomStructure(post)).toBe(false);
  });
});

describe('findGrandparentArticle', () => {
  it('returns the previous-cell article on a status detail page', () => {
    setPath('/alice/status/100');
    const parent = tweetArticle({ statusId: '99' });
    const target = tweetArticle({ statusId: '100' });
    document.body.append(cell(parent), cell(target));
    expect(findGrandparentArticle(target)).toBe(parent);
  });

  it('refuses to guess on the home feed (adjacent tweets are unrelated there)', () => {
    setPath('/home');
    const above = tweetArticle({ statusId: '1' });
    const target = tweetArticle({ statusId: '2' });
    document.body.append(cell(above), cell(target));
    expect(findGrandparentArticle(target)).toBeNull();
  });
});

describe('findArticleByStatusId', () => {
  it('finds the article carrying the given status id among many', () => {
    const a = tweetArticle({ statusId: '1' });
    const b = tweetArticle({ statusId: '2' });
    document.body.append(cell(a), cell(b));
    expect(findArticleByStatusId('2')).toBe(b);
    expect(findArticleByStatusId('404')).toBeNull();
  });

  it('page scope skips copies rendered inside X dialogs (the reply modal re-renders the target)', () => {
    // X's reply pop-up renders a copy of the tweet being replied to
    // inside a [role="dialog"] layer; the lock must stay on the
    // timeline copy, never snap to the modal's.
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    dialog.appendChild(tweetArticle({ statusId: '7' }));
    const timeline = tweetArticle({ statusId: '7' });
    document.body.append(dialog, cell(timeline));
    expect(findArticleByStatusId('7')).toBe(timeline);
  });

  it('page scope returns null when the only match lives inside a dialog', () => {
    const dialog = fromHTML('<div role="dialog"></div>');
    dialog.appendChild(tweetArticle({ statusId: '8' }));
    document.body.append(dialog);
    expect(findArticleByStatusId('8')).toBeNull();
  });

  it('modal scope finds only the aria-modal copy, never the timeline one', () => {
    // The mirror case: while the user works INSIDE the reply dialog /
    // lightbox, the lock belongs to the modal's copy.
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    const modalCopy = tweetArticle({ statusId: '9' });
    dialog.appendChild(modalCopy);
    const timeline = tweetArticle({ statusId: '9' });
    document.body.append(cell(timeline), dialog);
    expect(findArticleByStatusId('9', 'modal')).toBe(modalCopy);
    expect(findArticleByStatusId('9', 'modal')).not.toBe(timeline);
  });

  it('modal scope returns null when the tweet only exists on the page', () => {
    document.body.append(cell(tweetArticle({ statusId: '10' })));
    expect(findArticleByStatusId('10', 'modal')).toBeNull();
  });
});

describe('findArticleByTweetText', () => {
  it('finds the modal copy by text — the identity fallback when X strips the status link', () => {
    // The reply modal re-renders the locked tweet without anchors; the
    // highlight follows the lock into the modal via text identity.
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    const modalCopy = tweetArticle({ text: 'the locked tweet', statusId: '11' });
    dialog.appendChild(modalCopy);
    document.body.append(cell(tweetArticle({ text: 'the locked tweet', statusId: '11' })), dialog);
    expect(findArticleByTweetText('the locked tweet', 'modal')).toBe(modalCopy);
  });

  it('normalizes whitespace the same way the same-tweet merge does', () => {
    const article = tweetArticle({ text: 'spaced out text' });
    document.body.append(cell(article));
    expect(findArticleByTweetText('  spaced   out\n\ntext ')).toBe(article);
  });

  it('page scope skips dialog copies; empty text matches nothing', () => {
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    dialog.appendChild(tweetArticle({ text: 'only in modal' }));
    document.body.append(dialog);
    expect(findArticleByTweetText('only in modal')).toBeNull();
    expect(findArticleByTweetText('   ')).toBeNull();
  });

  it('returns null when no article carries the text', () => {
    document.body.append(cell(tweetArticle({ text: 'something else' })));
    expect(findArticleByTweetText('the locked tweet')).toBeNull();
  });

  it('matches a re-truncated copy of an expanded lock (Show more present)', () => {
    // The user expanded the long tweet to capture it; X's modal renders
    // it collapsed again. The truncated prefix + the Show more
    // affordance together identify it.
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    const truncatedCopy = tweetArticle({
      text: 'a long tweet that keeps going…',
      truncated: true,
    });
    dialog.appendChild(truncatedCopy);
    document.body.append(dialog);
    expect(
      findArticleByTweetText('a long tweet that keeps going well past the collapse point', 'modal'),
    ).toBe(truncatedCopy);
  });

  it('never prefix-matches an article without truncation evidence', () => {
    // A genuinely short tweet that happens to be a prefix of the lock
    // text must not steal the highlight.
    document.body.append(cell(tweetArticle({ text: 'a long tweet' })));
    expect(findArticleByTweetText('a long tweet that keeps going')).toBeNull();
  });

  it('matches a modal copy whose Show more label sits inside the tweet-text node', () => {
    // Some modal renderings nest the affordance INSIDE tweetText, so
    // the visible text ends "…Show more" — it must still read as a
    // truncated rendering of the expanded lock text.
    const dialog = fromHTML('<div role="dialog" aria-modal="true"></div>');
    const copy = fromHTML(`<article data-testid="tweet">
      <div data-testid="tweetText"><span>a long tweet that keeps going…</span><span data-testid="tweet-text-show-more-link">Show more</span></div>
    </article>`);
    dialog.appendChild(copy);
    document.body.append(dialog);
    expect(
      findArticleByTweetText('a long tweet that keeps going well past the collapse point', 'modal'),
    ).toBe(copy);
  });

  it('a trailing truncation ellipsis counts as evidence even without a Show-more control', () => {
    const bare = fromHTML(`<article data-testid="tweet">
      <div data-testid="tweetText"><span>a long tweet that keeps going…</span></div>
    </article>`);
    document.body.append(cell(bare));
    expect(
      findArticleByTweetText('a long tweet that keeps going well past the collapse point'),
    ).toBe(bare);
  });
});

describe('isXModalOpen', () => {
  it('is true while an aria-modal layer is open', () => {
    document.body.append(fromHTML('<div role="dialog" aria-modal="true"></div>'));
    expect(isXModalOpen()).toBe(true);
  });

  it('ignores non-modal dialogs (hover cards, menus carry no aria-modal)', () => {
    document.body.append(fromHTML('<div role="dialog"></div>'));
    expect(isXModalOpen()).toBe(false);
  });

  it('is false on a plain timeline', () => {
    document.body.append(cell(tweetArticle()));
    expect(isXModalOpen()).toBe(false);
  });
});

describe('extractReplyContextFromArticle', () => {
  it('captures target text and the grandparent above it on a status page', () => {
    setPath('/alice/status/100');
    const parent = tweetArticle({ statusId: '99', text: 'the thread opener' });
    const target = tweetArticle({ statusId: '100', text: 'the tweet to answer' });
    document.body.append(cell(parent), cell(target));
    const ctx = extractReplyContextFromArticle(target);
    expect(ctx).toMatchObject({
      targetText: 'the tweet to answer',
      targetStatusId: '100',
      grandparentText: 'the thread opener',
      hadUnreadableMedia: false,
    });
  });

  it('flags unreadable media on either the target or the grandparent', () => {
    setPath('/alice/status/100');
    const parent = tweetArticle({ statusId: '99', media: true });
    const target = tweetArticle({ statusId: '100' });
    document.body.append(cell(parent), cell(target));
    const ctx = extractReplyContextFromArticle(target);
    expect(ctx).toMatchObject({ hadUnreadableMedia: true });
  });

  it('returns an error for a text-empty target', () => {
    const target = tweetArticle({ text: '', media: true });
    document.body.append(cell(target));
    expect(extractReplyContextFromArticle(target)).toHaveProperty('error');
  });
});

describe('extractReplyContextFromComposer', () => {
  it('returns null when no composer is open', () => {
    expect(extractReplyContextFromComposer()).toBeNull();
  });

  it('targets the article nearest above the composer; the one above it is the grandparent', () => {
    const grandparent = tweetArticle({ statusId: '1', text: 'grandparent text' });
    const target = tweetArticle({ statusId: '2', text: 'target text' });
    const composer = fromHTML('<div data-testid="tweetTextarea_0"></div>');
    document.body.append(grandparent, target, composer);
    const ctx = extractReplyContextFromComposer();
    expect(ctx).toMatchObject({
      targetText: 'target text',
      targetStatusId: '2',
      grandparentText: 'grandparent text',
    });
  });

  it('errors when the composer has no tweet above it', () => {
    document.body.append(fromHTML('<div data-testid="tweetTextarea_0"></div>'));
    expect(extractReplyContextFromComposer()).toHaveProperty('error');
  });
});

describe('collectSelfThreadSpine (thread capture, Phase 10)', () => {
  /** Assemble cells into a conversation container on the page. */
  function conversation(...cells: HTMLElement[]): void {
    const wrap = fromHTML('<div></div>');
    for (const c of cells) wrap.appendChild(c);
    document.body.appendChild(wrap);
  }

  const alice = (statusId: string, text = `tweet ${statusId}`) =>
    tweetArticle({ handle: 'alice', statusId, text });
  const bob = (statusId: string) => tweetArticle({ handle: 'bob', statusId });

  it('collects the contiguous same-author run from the clicked root', () => {
    setPath('/alice/status/100');
    const a1 = alice('100');
    const a2 = alice('101');
    const a3 = alice('102');
    conversation(cell(a1), cell(a2), cell(a3), cell(bob('200')));
    const spine = collectSelfThreadSpine(a1);
    expect(spine).toEqual([a1, a2, a3]);
  });

  it('a mid-spine click walks UP to the root first', () => {
    setPath('/alice/status/101');
    const a1 = alice('100');
    const a2 = alice('101');
    const a3 = alice('102');
    conversation(cell(a1), cell(a2), cell(a3));
    expect(collectSelfThreadSpine(a2)).toEqual([a1, a2, a3]);
  });

  it('the first foreign article stops the walk — replies-to-replies never join', () => {
    setPath('/alice/status/100');
    const a1 = alice('100');
    const a2 = alice('101');
    const lateAlice = alice('103'); // alice replying to bob, deeper down
    conversation(cell(a1), cell(a2), cell(bob('200')), cell(lateAlice));
    expect(collectSelfThreadSpine(a1)).toEqual([a1, a2]);
  });

  it('article-less cells (the inline composer, dividers) are SKIPPED, not boundaries', () => {
    // Field-found: X renders the reply composer directly under the
    // focal tweet, so the root and its first reply are NOT adjacent
    // cells. The walk must cross junk in both directions.
    setPath('/alice/status/100');
    const a1 = alice('100');
    const a2 = alice('101');
    const a3 = alice('102');
    conversation(cell(a1), cell(null), cell(a2), cell(null), cell(a3));
    expect(collectSelfThreadSpine(a2)).toEqual([a1, a2, a3]); // up across junk finds the root
  });

  it('junk cells followed by a FOREIGN article still stop the walk', () => {
    setPath('/alice/status/100');
    const a1 = alice('100');
    const a2 = alice('101');
    conversation(cell(a1), cell(a2), cell(null), cell(bob('200')), cell(alice('103')));
    expect(collectSelfThreadSpine(a1)).toEqual([a1, a2]);
  });

  it('a chain hanging under someone ELSE’s tweet is a threaded reply, not a thread', () => {
    setPath('/bob/status/200');
    const parent = bob('200');
    const r1 = alice('101');
    const r2 = alice('102');
    conversation(cell(parent), cell(r1), cell(r2));
    expect(collectSelfThreadSpine(r1)).toEqual([r1]);
    // …including when junk cells separate the foreign parent.
    document.body.replaceChildren();
    const parent2 = bob('200');
    const r3 = alice('103');
    const r4 = alice('104');
    conversation(cell(parent2), cell(null), cell(r3), cell(r4));
    expect(collectSelfThreadSpine(r3)).toEqual([r3]);
  });

  it('a root wearing the Replying-to marker degrades to a single', () => {
    setPath('/alice/status/101');
    const r1 = tweetArticle({ handle: 'alice', statusId: '101', replyingTo: 'bob' });
    const r2 = alice('102');
    conversation(cell(r1), cell(r2));
    expect(collectSelfThreadSpine(r1)).toEqual([r1]);
  });

  it('does nothing off /status/ pages (feeds stack unrelated tweets)', () => {
    setPath('/home');
    const a1 = alice('100');
    const a2 = alice('101');
    conversation(cell(a1), cell(a2));
    expect(collectSelfThreadSpine(a1)).toEqual([a1]);
  });

  it('handle comparison is case-insensitive', () => {
    setPath('/alice/status/100');
    const a1 = tweetArticle({ handle: 'Alice', statusId: '100' });
    const a2 = tweetArticle({ handle: 'alice', statusId: '101' });
    conversation(cell(a1), cell(a2));
    expect(collectSelfThreadSpine(a1)).toHaveLength(2);
  });
});

describe('extractThread', () => {
  const seg = (statusId: string, text: string, media = false) =>
    tweetArticle({ handle: 'alice', statusId, text, media });

  it('reads ordered segments with per-segment status ids; root supplies author fields', () => {
    const out = extractThread([seg('100', 'first'), seg('101', 'second')]);
    if (typeof out === 'string') throw new Error(`unexpected failure: ${out}`);
    expect(out.segments).toEqual([
      { text: 'first', statusId: '100' },
      { text: 'second', statusId: '101' },
    ]);
    expect(out.authorHandle).toBe('alice');
    expect(out.authorDisplayName).toBe('Alice Doe');
  });

  it('ORs media across segments', () => {
    const out = extractThread([seg('100', 'first'), seg('101', 'second', true)]);
    if (typeof out === 'string') throw new Error(`unexpected failure: ${out}`);
    expect(out.hasMedia).toBe(true);
  });

  it('a text-less segment fails the whole capture honestly', () => {
    expect(extractThread([seg('100', 'first'), tweetArticle({ handle: 'alice', text: '' })])).toBe(
      'missing-text',
    );
    expect(
      extractThread([
        seg('100', 'first'),
        tweetArticle({ handle: 'alice', text: '', media: true }),
      ]),
    ).toBe('media-only');
  });
});
