import { describe, expect, it } from 'vitest';
import { emitDraftCommit, onDraftCommit, type DraftCommit } from './commit';

function commit(overrides: Partial<DraftCommit> = {}): DraftCommit {
  return {
    text: 'shipped text',
    segments: null,
    mode: 'post',
    handEdited: false,
    seedBundleId: null,
    committedAt: 1,
    ...overrides,
  };
}

describe('draft commit hook', () => {
  it('delivers a commit to every subscriber', () => {
    const seen: DraftCommit[] = [];
    const un1 = onDraftCommit((c) => seen.push(c));
    const un2 = onDraftCommit((c) => seen.push(c));
    emitDraftCommit(commit({ text: 'hello', mode: 'reply', handEdited: true }));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ text: 'hello', mode: 'reply', handEdited: true });
    un1();
    un2();
  });

  it('unsubscribe stops delivery', () => {
    let calls = 0;
    const un = onDraftCommit(() => calls++);
    emitDraftCommit(commit());
    un();
    emitDraftCommit(commit());
    expect(calls).toBe(1);
  });

  it('emitting with no subscribers is fine (v1 wiring: nothing listens)', () => {
    expect(() => emitDraftCommit(commit())).not.toThrow();
  });

  it('a throwing listener does not starve its siblings', () => {
    let delivered = false;
    const unBad = onDraftCommit(() => {
      throw new Error('misbehaving listener');
    });
    const unGood = onDraftCommit(() => {
      delivered = true;
    });
    expect(() => emitDraftCommit(commit())).not.toThrow();
    expect(delivered).toBe(true);
    unBad();
    unGood();
  });
});
