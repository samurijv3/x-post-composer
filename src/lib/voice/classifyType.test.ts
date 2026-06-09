import { describe, expect, it } from 'vitest';
import { classifyType, type TweetContext } from './classifyType';

function ctx(overrides: Partial<TweetContext> = {}): TweetContext {
  return {
    hasReplyContextNode: overrides.hasReplyContextNode ?? false,
    inReplyToStatusId: overrides.inReplyToStatusId ?? null,
    isPrecededByParentArticle: overrides.isPrecededByParentArticle ?? false,
  };
}

describe('classifyType', () => {
  it('classifies plain tweets as posts', () => {
    expect(classifyType(ctx())).toBe('post');
  });

  it('classifies tweets with a "Replying to" node as replies', () => {
    expect(classifyType(ctx({ hasReplyContextNode: true }))).toBe('reply');
  });

  it('classifies tweets with a parent status id as replies', () => {
    expect(classifyType(ctx({ inReplyToStatusId: '12345' }))).toBe('reply');
  });

  it('classifies status-detail-page replies (parent renders above) as replies', () => {
    expect(classifyType(ctx({ isPrecededByParentArticle: true }))).toBe('reply');
  });

  it('prefers the reply signal when multiple are present', () => {
    expect(
      classifyType(
        ctx({
          hasReplyContextNode: true,
          inReplyToStatusId: '12345',
          isPrecededByParentArticle: true,
        }),
      ),
    ).toBe('reply');
  });

  it('treats an empty-string parent id as no signal', () => {
    expect(classifyType(ctx({ inReplyToStatusId: '' }))).toBe('post');
  });
});
