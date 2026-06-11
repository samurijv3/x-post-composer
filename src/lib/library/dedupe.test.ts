import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../types';
import { findLibraryDuplicate, mergeLibraryDuplicate } from './dedupe';

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'uuid-1',
    text: 'the tweet text',
    type: 'post',
    source: 'manual',
    authorHandle: 'me',
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
    embedding: null,
    createdAt: 1,
    ...overrides,
  };
}

describe('findLibraryDuplicate', () => {
  it('matches by tweet id when the candidate carries one', () => {
    const existing = item({ id: '12345', text: 'captured wording' });
    expect(findLibraryDuplicate([existing], { statusId: '12345', text: 'different wording' })).toBe(
      existing,
    );
  });

  it('falls back to normalized text — the shipped-then-handpicked case', () => {
    // The shipped record has a uuid id; the handpick has a status id.
    const shipped = item({ id: 'uuid-9', source: 'shipped', text: 'we shipped  this\nthing' });
    expect(
      findLibraryDuplicate([shipped], { statusId: '777', text: 'we shipped this thing' }),
    ).toBe(shipped);
  });

  it('matches by text when the candidate has no id (shipped saves, manual paste)', () => {
    const existing = item({ text: 'already here' });
    expect(findLibraryDuplicate([existing], { statusId: null, text: '  already here ' })).toBe(
      existing,
    );
  });

  it('returns null for genuinely new items and empty text', () => {
    expect(findLibraryDuplicate([item()], { statusId: null, text: 'brand new' })).toBeNull();
    expect(findLibraryDuplicate([item()], { statusId: '404', text: 'brand new' })).toBeNull();
    expect(findLibraryDuplicate([item()], { statusId: null, text: '   ' })).toBeNull();
  });
});

describe('mergeLibraryDuplicate', () => {
  it('a handpick of a shipped item promotes it to manual, in place', () => {
    const shipped = item({ id: 'uuid-9', source: 'shipped', authorDisplayName: null });
    const handpick = item({
      id: '777',
      source: 'manual',
      text: 'refreshed read',
      authorDisplayName: 'Sam',
      authorAvatarUrl: 'https://pbs.twimg.com/a.jpg',
    });
    const merged = mergeLibraryDuplicate(shipped, handpick);
    expect(merged.source).toBe('manual');
    expect(merged.text).toBe('refreshed read');
    expect(merged.authorDisplayName).toBe('Sam');
    // The record keeps its storage identity and history.
    expect(merged.id).toBe('uuid-9');
    expect(merged.createdAt).toBe(1);
  });

  it('a lower-precedence write never downgrades — returns the existing object untouched', () => {
    const manual = item({ source: 'manual' });
    const shippedSave = item({ id: 'uuid-2', source: 'shipped', text: 'same tweet' });
    expect(mergeLibraryDuplicate(manual, shippedSave)).toBe(manual);

    const shipped = item({ source: 'shipped' });
    const archiveRow = item({ id: 'uuid-3', source: 'archive' });
    expect(mergeLibraryDuplicate(shipped, archiveRow)).toBe(shipped);
  });

  it('a shipped save upgrades an archive row (Phase 7 inherits this)', () => {
    const archive = item({ source: 'archive' });
    const shipped = item({ id: 'uuid-2', source: 'shipped' });
    expect(mergeLibraryDuplicate(archive, shipped).source).toBe('shipped');
  });

  it('equal precedence refreshes the record without losing enrichment', () => {
    const existing = item({
      authorDisplayName: 'Sam',
      authorAvatarUrl: 'https://pbs.twimg.com/a.jpg',
    });
    const recapture = item({
      id: '888',
      text: 'newer read',
      authorDisplayName: null,
      authorAvatarUrl: null,
    });
    const merged = mergeLibraryDuplicate(existing, recapture);
    expect(merged.text).toBe('newer read');
    // Fresh read couldn't see the metadata — existing enrichment kept.
    expect(merged.authorDisplayName).toBe('Sam');
    expect(merged.authorAvatarUrl).toBe('https://pbs.twimg.com/a.jpg');
  });
});
