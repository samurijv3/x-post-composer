import { afterEach, describe, expect, it } from 'vitest';
import {
  detectReplyByDomStructure,
  detectReplyContext,
  extractReplyContextFromArticle,
  extractReplyContextFromComposer,
  extractTweet,
  findArticleByStatusId,
  findGrandparentArticle,
  hasMedia,
  isTweetTruncated,
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
