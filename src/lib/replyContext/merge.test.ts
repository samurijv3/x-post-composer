import { describe, expect, it } from 'vitest';
import type { ReplyContext } from '../../types';
import { isTruncatedRenderingOf, mergeReplyContextSelection } from './merge';

function ctx(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return {
    targetText: 'the tweet text',
    targetAuthorHandle: 'alice',
    targetAuthorDisplayName: 'Alice Doe',
    targetAuthorAvatarUrl: 'https://pbs.twimg.com/a.jpg',
    targetTimestamp: '2026-06-01T12:00:00.000Z',
    targetStatusId: '111',
    grandparentText: null,
    hadUnreadableMedia: false,
    ...overrides,
  };
}

/** The metadata-poor shape X's reply modal delivers: same text, but no
 *  author links and no /status/ anchor to read. */
function modalDelivery(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return ctx({
    targetAuthorHandle: null,
    targetAuthorDisplayName: null,
    targetStatusId: null,
    ...overrides,
  });
}

describe('mergeReplyContextSelection', () => {
  it('returns the incoming selection when there is no existing lock', () => {
    const incoming = modalDelivery();
    expect(mergeReplyContextSelection(null, incoming)).toBe(incoming);
  });

  it('re-selecting the same tweet via a degraded modal delivery keeps the rich fields', () => {
    const merged = mergeReplyContextSelection(ctx(), modalDelivery());
    expect(merged.targetStatusId).toBe('111');
    expect(merged.targetAuthorHandle).toBe('alice');
    expect(merged.targetAuthorDisplayName).toBe('Alice Doe');
    expect(merged.targetText).toBe('the tweet text');
  });

  it('matches the same tweet by normalized text when the modal copy has no status id', () => {
    const merged = mergeReplyContextSelection(
      ctx({ targetText: 'spaced   out\ntext' }),
      modalDelivery({ targetText: 'spaced out text' }),
    );
    expect(merged.targetStatusId).toBe('111');
  });

  it('matches by status id when both deliveries carry one', () => {
    const merged = mergeReplyContextSelection(
      ctx({ targetText: 'old reading' }),
      ctx({ targetText: 'new reading', targetAuthorDisplayName: null }),
    );
    // Same id → merge; fresh text wins, missing display name backfills.
    expect(merged.targetText).toBe('new reading');
    expect(merged.targetAuthorDisplayName).toBe('Alice Doe');
  });

  it('different status ids are different tweets — plain swap, even with identical text', () => {
    const incoming = ctx({ targetStatusId: '222' });
    expect(mergeReplyContextSelection(ctx(), incoming)).toBe(incoming);
  });

  it('different text with no ids to compare is a plain swap', () => {
    const incoming = modalDelivery({ targetText: 'a wholly different tweet' });
    expect(mergeReplyContextSelection(ctx({ targetStatusId: null }), incoming)).toBe(incoming);
  });

  it('the fresh reading wins field-wise; the existing lock only fills gaps', () => {
    const merged = mergeReplyContextSelection(
      ctx({ grandparentText: 'thread opener' }),
      modalDelivery({ targetAuthorAvatarUrl: 'https://pbs.twimg.com/fresh.jpg' }),
    );
    expect(merged.targetAuthorAvatarUrl).toBe('https://pbs.twimg.com/fresh.jpg');
    expect(merged.grandparentText).toBe('thread opener');
  });

  it('recognizes a truncated rendering as a prefix of the full text', () => {
    const full = 'a long tweet that keeps going well past the collapse point';
    expect(isTruncatedRenderingOf(full, 'a long tweet that keeps going…')).toBe(true);
    expect(isTruncatedRenderingOf(full, 'a long tweet that keeps going...')).toBe(true);
    expect(isTruncatedRenderingOf(full, 'a  long\ntweet that keeps going')).toBe(true);
  });

  it('rejects non-prefixes, equal text, and empty partials as truncated renderings', () => {
    const full = 'a long tweet that keeps going';
    expect(isTruncatedRenderingOf(full, 'a different opening…')).toBe(false);
    // Equal text is exact identity, not a truncation — callers handle it.
    expect(isTruncatedRenderingOf(full, full)).toBe(false);
    expect(isTruncatedRenderingOf(full, '…')).toBe(false);
    expect(isTruncatedRenderingOf(full, '')).toBe(false);
  });

  it('media-unreadability sticks if either reading saw it', () => {
    expect(
      mergeReplyContextSelection(ctx({ hadUnreadableMedia: true }), modalDelivery())
        .hadUnreadableMedia,
    ).toBe(true);
    expect(
      mergeReplyContextSelection(ctx(), modalDelivery({ hadUnreadableMedia: true }))
        .hadUnreadableMedia,
    ).toBe(true);
  });
});
