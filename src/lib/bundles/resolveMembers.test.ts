import { describe, expect, it } from 'vitest';
import type { Bundle, LibraryItem } from '../../types';
import { appendBundleMember, moveBundleMember, resolveBundleMembers } from './resolveMembers';

function item(id: string): LibraryItem {
  return {
    id,
    text: id,
    type: 'post',
    source: 'manual',
    authorHandle: 'me',
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
    favorite: false,
    embedding: null,
    createdAt: 0,
  };
}

function bundle(memberIds: string[]): Bundle {
  return { id: 'b1', name: 'Day X', memberIds, createdAt: 1 };
}

describe('resolveBundleMembers', () => {
  it('returns members in the bundle’s stored order, not library order', () => {
    const lib = [item('a'), item('b'), item('c')];
    const out = resolveBundleMembers(['c', 'a', 'b'], lib);
    expect(out.members.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(out.missingCount).toBe(0);
  });

  it('drops dangling ids and counts them honestly', () => {
    const lib = [item('a'), item('c')];
    const out = resolveBundleMembers(['a', 'deleted-1', 'c', 'deleted-2'], lib);
    expect(out.members.map((m) => m.id)).toEqual(['a', 'c']);
    expect(out.missingCount).toBe(2);
  });

  it('resolves a duplicated id once, at its first position (defensive)', () => {
    const lib = [item('a'), item('b')];
    const out = resolveBundleMembers(['b', 'a', 'b'], lib);
    expect(out.members.map((m) => m.id)).toEqual(['b', 'a']);
    expect(out.missingCount).toBe(0);
  });

  it('handles an all-dangling bundle: zero members, full missing count', () => {
    const out = resolveBundleMembers(['x', 'y'], []);
    expect(out.members).toEqual([]);
    expect(out.missingCount).toBe(2);
  });
});

describe('appendBundleMember', () => {
  it('appends a new member at the end (auto-filing order)', () => {
    const out = appendBundleMember(bundle(['a', 'b']), 'c');
    expect(out.memberIds).toEqual(['a', 'b', 'c']);
  });

  it('returns the bundle by identity when the id is already a member', () => {
    const b = bundle(['a', 'b']);
    expect(appendBundleMember(b, 'a')).toBe(b);
  });

  it('never mutates the input bundle', () => {
    const b = bundle(['a']);
    appendBundleMember(b, 'z');
    expect(b.memberIds).toEqual(['a']);
  });
});

describe('moveBundleMember', () => {
  const present = (...ids: string[]) => new Set(ids);

  it('swaps with the adjacent member', () => {
    const out = moveBundleMember(bundle(['a', 'b', 'c']), 'b', 'up', present('a', 'b', 'c'));
    expect(out.memberIds).toEqual(['b', 'a', 'c']);
    const down = moveBundleMember(bundle(['a', 'b', 'c']), 'b', 'down', present('a', 'b', 'c'));
    expect(down.memberIds).toEqual(['a', 'c', 'b']);
  });

  it('skips over dangling ids — one visible step, not one stored slot', () => {
    // 'gone' sits between a and b but no longer resolves; moving b up
    // must land it ABOVE a, not invisibly inside the hole.
    const out = moveBundleMember(bundle(['a', 'gone', 'b']), 'b', 'up', present('a', 'b'));
    expect(out.memberIds).toEqual(['b', 'gone', 'a']);
  });

  it('returns the bundle by identity at the visible ends and for unknown ids', () => {
    const b = bundle(['a', 'gone', 'b']);
    const ids = present('a', 'b');
    expect(moveBundleMember(b, 'a', 'up', ids)).toBe(b);
    expect(moveBundleMember(b, 'b', 'down', ids)).toBe(b);
    expect(moveBundleMember(b, 'nope', 'down', ids)).toBe(b);
  });

  it('never mutates the input bundle', () => {
    const b = bundle(['a', 'b']);
    moveBundleMember(b, 'b', 'up', present('a', 'b'));
    expect(b.memberIds).toEqual(['a', 'b']);
  });
});
