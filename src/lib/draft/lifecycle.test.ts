import { describe, expect, it } from 'vitest';
import type { Span } from '../exclusion';
import {
  INITIAL_DRAFT_LIFECYCLE,
  reduceDraftLifecycle,
  type DraftEvent,
  type DraftLifecycleState,
  type ModelDraft,
} from './lifecycle';

function span(): Span {
  return { start: 0, end: 1, rule: 'emDash', matchedText: '—' };
}

/** Run a sequence of events from the initial state. */
function run(...events: DraftEvent[]): DraftLifecycleState {
  return events.reduce(reduceDraftLifecycle, INITIAL_DRAFT_LIFECYCLE);
}

/** Single-post model output (the N=1 case). */
const modelDraft = (text: string, violations: Span[] = []): ModelDraft => ({
  kind: 'single',
  posts: [{ text, residualViolations: violations }],
  wasRepaired: false,
  targetCount: null,
});

/** Thread model output. */
const threadDraft = (texts: string[], targetCount: number | null = texts.length): ModelDraft => ({
  kind: 'thread',
  posts: texts.map((text) => ({ text, residualViolations: [] })),
  wasRepaired: false,
  targetCount,
});

const firstText = (s: DraftLifecycleState): string | undefined => s.content?.posts[0]?.text;

/** empty → generating → active with one draft in hand. */
function activeWith(text = 'first draft', violations: Span[] = []): DraftLifecycleState {
  return run(
    { type: 'generation-started', seq: 1 },
    { type: 'generation-succeeded', seq: 1, draft: modelDraft(text, violations) },
  );
}

describe('generation', () => {
  it('walks empty → generating → active on the first draft', () => {
    const generating = run({ type: 'generation-started', seq: 1 });
    expect(generating.phase).toBe('generating');
    expect(generating.content).toBeNull();

    const active = reduceDraftLifecycle(generating, {
      type: 'generation-succeeded',
      seq: 1,
      draft: modelDraft('hello'),
    });
    expect(active.phase).toBe('active');
    expect(firstText(active)).toBe('hello');
    expect(active.content?.handEdited).toBe(false);
    expect(active.content?.posts[0]?.copied).toBe(false);
    // First draft replaced nothing — no timed-undo window.
    expect(active.replaced).toBeNull();
  });

  it('IGNORES a stale success — an old request must not flip a newer draft back', () => {
    const state = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('stale') },
    );
    expect(state.phase).toBe('generating'); // still waiting on seq 2
    expect(state.content).toBeNull();

    const after2 = reduceDraftLifecycle(state, {
      type: 'generation-succeeded',
      seq: 2,
      draft: modelDraft('fresh'),
    });
    expect(firstText(after2)).toBe('fresh');

    // seq 1 resolving even later is equally dead.
    const lateStale = reduceDraftLifecycle(after2, {
      type: 'generation-succeeded',
      seq: 1,
      draft: modelDraft('zombie'),
    });
    expect(lateStale).toBe(after2);
  });

  it('ignores stale failures the same way', () => {
    const state = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-failed', seq: 1 },
    );
    expect(state.phase).toBe('generating');
  });

  it('a failed generation returns to the old draft when one exists, else to empty', () => {
    const fromEmpty = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-failed', seq: 1 },
    );
    expect(fromEmpty.phase).toBe('empty');

    const fromActive = reduceDraftLifecycle(
      reduceDraftLifecycle(activeWith('keep me'), { type: 'generation-started', seq: 2 }),
      { type: 'generation-failed', seq: 2 },
    );
    expect(fromActive.phase).toBe('active');
    expect(firstText(fromActive)).toBe('keep me');
  });

  it('a regenerate keeps the outgoing draft visible, then opens the timed-undo window', () => {
    const regenerating = reduceDraftLifecycle(activeWith('old'), {
      type: 'generation-started',
      seq: 2,
    });
    expect(regenerating.phase).toBe('generating');
    expect(firstText(regenerating)).toBe('old'); // still on screen

    const replaced = reduceDraftLifecycle(regenerating, {
      type: 'generation-succeeded',
      seq: 2,
      draft: modelDraft('new'),
    });
    expect(firstText(replaced)).toBe('new');
    expect(replaced.replaced?.content.posts[0]?.text).toBe('old'); // undo can bring it back
    expect(replaced.replaced?.workbench).toBeNull(); // regenerate keeps angle + lock on screen
  });
});

describe('hand edits', () => {
  it('clear residual violations and mark the draft hand-edited — exclusions are bypassed', () => {
    const edited = reduceDraftLifecycle(activeWith('draft — text', [span()]), {
      type: 'hand-edited',
      postIndex: 0,
      text: 'my own words',
    });
    expect(firstText(edited)).toBe('my own words');
    expect(edited.content?.posts[0]?.residualViolations).toEqual([]);
    expect(edited.content?.handEdited).toBe(true);
    expect(edited.phase).toBe('active');
  });

  it('adopt a just-replaced draft (the replacement stands; timed undo drops)', () => {
    const replaced = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('old') },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('new') },
    );
    expect(replaced.replaced).not.toBeNull();
    const touched = reduceDraftLifecycle(replaced, {
      type: 'hand-edited',
      postIndex: 0,
      text: 'new + me',
    });
    expect(touched.replaced).toBeNull();
  });

  it('un-commit a committed draft — edits ride through the next copy', () => {
    const committed = reduceDraftLifecycle(activeWith(), { type: 'post-copied', postIndex: 0 });
    expect(committed.phase).toBe('committed');
    const edited = reduceDraftLifecycle(committed, {
      type: 'hand-edited',
      postIndex: 0,
      text: 'revised',
    });
    expect(edited.phase).toBe('active');
    expect(edited.content?.posts[0]?.copied).toBe(false); // clipboard is stale now
  });

  it('do NOT clear the one-level refine snapshot (it must survive)', () => {
    const refined = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('original') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('refined') },
    );
    const edited = reduceDraftLifecycle(refined, {
      type: 'hand-edited',
      postIndex: 0,
      text: 'refined + me',
    });
    expect(edited.refineSnapshot?.posts[0]?.text).toBe('original');

    const undone = reduceDraftLifecycle(edited, { type: 'refine-undone' });
    expect(firstText(undone)).toBe('original');
    expect(undone.refineSnapshot).toBeNull();
  });

  it('are no-ops while generating or empty, and for unknown post indexes', () => {
    expect(run({ type: 'hand-edited', postIndex: 0, text: 'x' }).phase).toBe('empty');
    const generating = run({ type: 'generation-started', seq: 1 });
    expect(reduceDraftLifecycle(generating, { type: 'hand-edited', postIndex: 0, text: 'x' })).toBe(
      generating,
    );
    const active = activeWith('one post');
    expect(reduceDraftLifecycle(active, { type: 'hand-edited', postIndex: 5, text: 'x' })).toBe(
      active,
    );
  });
});

describe('refine (one-level undo scope)', () => {
  it('a refine reshapes without opening the timed-undo window', () => {
    const refined = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('original') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('refined') },
    );
    expect(firstText(refined)).toBe('refined');
    expect(refined.replaced).toBeNull(); // not a replacement
    expect(refined.refineSnapshot?.posts[0]?.text).toBe('original');
  });

  it('refining a just-replaced draft adopts it (timed undo drops at refine start)', () => {
    const replaced = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('old') },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('new') },
    );
    const refining = reduceDraftLifecycle(replaced, { type: 'refine-started', seq: 3 });
    expect(refining.replaced).toBeNull();
  });

  it('a new generation ends the refine-undo chain (pre-lifecycle behavior preserved)', () => {
    const state = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('original') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('refined') },
      { type: 'generation-started', seq: 3 },
    );
    expect(state.refineSnapshot).toBeNull();
  });

  it('refine-started without a draft is a no-op', () => {
    expect(run({ type: 'refine-started', seq: 1 })).toEqual(INITIAL_DRAFT_LIFECYCLE);
  });
});

describe('timed undo (replacement scope)', () => {
  it('replacement-undone restores the replaced draft as active', () => {
    const replaced = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('old') },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('new') },
    );
    const undone = reduceDraftLifecycle(replaced, { type: 'replacement-undone' });
    expect(undone.phase).toBe('active');
    expect(firstText(undone)).toBe('old');
    expect(undone.replaced).toBeNull();
  });

  it('replacement-expired drops the snapshot and nothing else', () => {
    const replaced = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('old') },
      { type: 'generation-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('new') },
    );
    const expired = reduceDraftLifecycle(replaced, { type: 'replacement-expired' });
    expect(expired.replaced).toBeNull();
    expect(firstText(expired)).toBe('new');
  });

  it('both undo scopes coexist on one draft', () => {
    // Refine, then regenerate: the regenerate opens the timed window
    // while the refine chain was already ended by generation-started.
    const refined = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('v1') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('v2') },
    );
    expect(refined.refineSnapshot?.posts[0]?.text).toBe('v1'); // refine undo live
    const regenerated = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('v1') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('v2') },
      { type: 'generation-started', seq: 3 },
      { type: 'generation-succeeded', seq: 3, draft: modelDraft('v3') },
    );
    expect(regenerated.replaced?.content.posts[0]?.text).toBe('v2'); // timed undo live
    expect(regenerated.refineSnapshot).toBeNull(); // refine chain ended
  });
});

describe('new context', () => {
  it('clears an active draft into the timed-undo window and empties the workbench', () => {
    const oldContext = {
      targetText: 'the old tweet',
      targetAuthorHandle: 'alice',
      targetAuthorDisplayName: null,
      targetAuthorAvatarUrl: null,
      targetTimestamp: null,
      targetStatusId: '1',
      grandparentText: null,
      hadUnreadableMedia: false,
    };
    const cleared = reduceDraftLifecycle(activeWith('reply to old tweet'), {
      type: 'new-context',
      bullets: 'my angle for the old tweet',
      previousContext: oldContext,
    });
    expect(cleared.phase).toBe('empty');
    expect(cleared.content).toBeNull();
    expect(cleared.replaced?.content.posts[0]?.text).toBe('reply to old tweet');
    // One Undo restores the whole workbench: draft, angle, and lock.
    expect(cleared.replaced?.workbench?.bullets).toBe('my angle for the old tweet');
    expect(cleared.replaced?.workbench?.replyContext).toBe(oldContext);

    const undone = reduceDraftLifecycle(cleared, { type: 'replacement-undone' });
    expect(undone.phase).toBe('active');
    expect(firstText(undone)).toBe('reply to old tweet');
  });

  it('invalidates an in-flight generation — its result was for the old context', () => {
    const state = run(
      { type: 'generation-started', seq: 1 },
      { type: 'new-context', bullets: '', previousContext: null },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('for the old context') },
    );
    expect(state.phase).toBe('empty');
    expect(state.content).toBeNull();
  });

  it('is a no-op on an empty workbench', () => {
    expect(
      run({ type: 'new-context', bullets: 'typed in advance', previousContext: null }),
    ).toEqual(INITIAL_DRAFT_LIFECYCLE);
  });
});

describe('bundle seed (rides the draft to commit)', () => {
  const seeded = run(
    { type: 'generation-started', seq: 1 },
    { type: 'generation-succeeded', seq: 1, draft: modelDraft('day 12'), seedBundleId: 'b1' },
  );

  it('a generate stamps the seed from its request; absent means sampled (null)', () => {
    expect(seeded.content?.seedBundleId).toBe('b1');
    expect(activeWith('sampled').content?.seedBundleId).toBeNull();
  });

  it('a refine keeps the seed — it reshapes the same draft (event value ignored)', () => {
    const refined = [
      { type: 'refine-started', seq: 2 } as const,
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('day 12, punchier') } as const,
    ].reduce(reduceDraftLifecycle, seeded);
    expect(refined.content?.seedBundleId).toBe('b1');
  });

  it('a hand edit keeps the seed — editing does not change provenance', () => {
    const edited = reduceDraftLifecycle(seeded, {
      type: 'hand-edited',
      postIndex: 0,
      text: 'day 12 + me',
    });
    expect(edited.content?.seedBundleId).toBe('b1');
  });

  it('a fresh unseeded generate clears it; the timed undo restores it with the draft', () => {
    const replaced = [
      { type: 'generation-started', seq: 2 } as const,
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('unrelated') } as const,
    ].reduce(reduceDraftLifecycle, seeded);
    expect(replaced.content?.seedBundleId).toBeNull();
    const undone = reduceDraftLifecycle(replaced, { type: 'replacement-undone' });
    expect(undone.content?.seedBundleId).toBe('b1');
  });
});

describe('commit (post-copied) and discard', () => {
  it('a single commits on its one copy, resolving both undo scopes', () => {
    const withBoth = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('v1') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('v2') },
    );
    const committed = reduceDraftLifecycle(withBoth, { type: 'post-copied', postIndex: 0 });
    expect(committed.phase).toBe('committed');
    expect(committed.replaced).toBeNull();
    expect(committed.refineSnapshot).toBeNull();
    expect(firstText(committed)).toBe('v2');
  });

  it('post-copied is a no-op outside active/committed and for unknown indexes', () => {
    expect(run({ type: 'post-copied', postIndex: 0 })).toEqual(INITIAL_DRAFT_LIFECYCLE);
    const generating = run({ type: 'generation-started', seq: 1 });
    expect(reduceDraftLifecycle(generating, { type: 'post-copied', postIndex: 0 })).toBe(
      generating,
    );
    const active = activeWith();
    expect(reduceDraftLifecycle(active, { type: 'post-copied', postIndex: 3 })).toBe(active);
  });

  it('a committed draft can be regenerated, with the timed undo guarding it', () => {
    const committed = reduceDraftLifecycle(activeWith('shipped'), {
      type: 'post-copied',
      postIndex: 0,
    });
    const replaced = reduceDraftLifecycle(
      reduceDraftLifecycle(committed, { type: 'generation-started', seq: 9 }),
      { type: 'generation-succeeded', seq: 9, draft: modelDraft('next take') },
    );
    expect(firstText(replaced)).toBe('next take');
    expect(replaced.replaced?.content.posts[0]?.text).toBe('shipped');
  });

  it('discard resets everything', () => {
    const discarded = reduceDraftLifecycle(activeWith(), { type: 'discarded' });
    expect(discarded).toEqual(INITIAL_DRAFT_LIFECYCLE);
  });
});

describe('threads (multi-post drafts)', () => {
  const activeThread = (texts = ['one', 'two', 'three']) =>
    run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: threadDraft(texts) },
    );

  it('lands as kind thread with per-post content and the target', () => {
    const t = activeThread();
    expect(t.content?.kind).toBe('thread');
    expect(t.content?.posts).toHaveLength(3);
    expect(t.content?.targetCount).toBe(3);
    expect(t.content?.posts.every((p) => !p.copied)).toBe(true);
  });

  it('hand-editing one post touches only that post', () => {
    const before = activeThread();
    const edited = reduceDraftLifecycle(before, {
      type: 'hand-edited',
      postIndex: 1,
      text: 'two, but mine',
    });
    expect(edited.content?.posts[1]?.text).toBe('two, but mine');
    expect(edited.content?.posts[0]?.text).toBe('one');
    expect(edited.content?.handEdited).toBe(true);
  });

  it('commits only when EVERY post has been copied', () => {
    const one = reduceDraftLifecycle(activeThread(), { type: 'post-copied', postIndex: 0 });
    expect(one.phase).toBe('active');
    const two = reduceDraftLifecycle(one, { type: 'post-copied', postIndex: 2 });
    expect(two.phase).toBe('active');
    const all = reduceDraftLifecycle(two, { type: 'post-copied', postIndex: 1 });
    expect(all.phase).toBe('committed');
    expect(all.replaced).toBeNull();
    expect(all.refineSnapshot).toBeNull();
  });

  it('editing a copied post un-copies it — commit needs a fresh copy of that post', () => {
    const partly = [
      { type: 'post-copied', postIndex: 0 } as const,
      { type: 'post-copied', postIndex: 1 } as const,
      { type: 'hand-edited', postIndex: 0, text: 'one, revised' } as const,
      { type: 'post-copied', postIndex: 2 } as const,
    ].reduce(reduceDraftLifecycle, activeThread());
    expect(partly.phase).toBe('active'); // post 0's copy went stale
    const done = reduceDraftLifecycle(partly, { type: 'post-copied', postIndex: 0 });
    expect(done.phase).toBe('committed');
  });

  it('fresh model output (a refine) resets every copied flag', () => {
    const reshaped = (
      [
        { type: 'post-copied', postIndex: 0 },
        { type: 'refine-started', seq: 2 },
        {
          type: 'generation-succeeded',
          seq: 2,
          draft: threadDraft(['one!', 'two!', 'three!'], null),
        },
      ] as DraftEvent[]
    ).reduce(reduceDraftLifecycle, activeThread());
    expect(reshaped.content?.posts.every((p) => !p.copied)).toBe(true);
  });

  it('a non-repack refine keeps the draft’s own target; a repack updates it', () => {
    const base = activeThread(['a', 'b', 'c', 'd']); // target 4
    const polished = (
      [
        { type: 'refine-started', seq: 2 },
        {
          type: 'generation-succeeded',
          seq: 2,
          draft: threadDraft(['a!', 'b!', 'c!', 'd!'], null),
        },
      ] as DraftEvent[]
    ).reduce(reduceDraftLifecycle, base);
    expect(polished.content?.targetCount).toBe(4); // carried over

    const repacked = (
      [
        { type: 'refine-started', seq: 3 },
        { type: 'generation-succeeded', seq: 3, draft: threadDraft(['ab', 'cd'], 2) },
      ] as DraftEvent[]
    ).reduce(reduceDraftLifecycle, polished);
    expect(repacked.content?.targetCount).toBe(2);
  });

  it('the refine undo restores the pre-refine thread, copies and all', () => {
    const before = reduceDraftLifecycle(activeThread(), { type: 'post-copied', postIndex: 0 });
    const reshaped = (
      [
        { type: 'refine-started', seq: 2 },
        { type: 'generation-succeeded', seq: 2, draft: threadDraft(['merged into one'], null) },
      ] as DraftEvent[]
    ).reduce(reduceDraftLifecycle, before);
    expect(reshaped.content?.posts).toHaveLength(1);
    const undone = reduceDraftLifecycle(reshaped, { type: 'refine-undone' });
    expect(undone.content?.posts).toHaveLength(3);
    expect(undone.content?.posts[0]?.copied).toBe(true); // snapshot kept the flag
  });
});

describe('post-replaced (scoped thread refines)', () => {
  const activeThread = () =>
    run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: threadDraft(['one', 'two', 'three']) },
    );
  const replacement = (seq: number, postIndex: number, text: string): DraftEvent => ({
    type: 'post-replaced',
    seq,
    postIndex,
    post: { text, residualViolations: [span()] },
    wasRepaired: false,
  });

  it('replaces exactly one post; only ITS copied flag resets', () => {
    const partlyCopied = [
      { type: 'post-copied', postIndex: 0 } as const,
      { type: 'post-copied', postIndex: 1 } as const,
      { type: 'refine-started', seq: 2 } as const,
    ].reduce(reduceDraftLifecycle, activeThread());
    const out = reduceDraftLifecycle(partlyCopied, replacement(2, 1, 'two, rewritten'));
    expect(out.phase).toBe('active');
    expect(out.content?.posts.map((p) => p.text)).toEqual(['one', 'two, rewritten', 'three']);
    expect(out.content?.posts[0]?.copied).toBe(true); // untouched
    expect(out.content?.posts[1]?.copied).toBe(false); // text changed
    expect(out.content?.posts[1]?.residualViolations).toHaveLength(1);
  });

  it('is stale-gated like generation-succeeded', () => {
    const racing = [
      { type: 'refine-started', seq: 2 } as const,
      { type: 'refine-started', seq: 3 } as const,
    ].reduce(reduceDraftLifecycle, activeThread());
    expect(reduceDraftLifecycle(racing, replacement(2, 0, 'stale'))).toBe(racing);
    const landed = reduceDraftLifecycle(racing, replacement(3, 0, 'fresh'));
    expect(landed.content?.posts[0]?.text).toBe('fresh');
  });

  it('an out-of-range index still resolves the request, draft untouched', () => {
    const refining = reduceDraftLifecycle(activeThread(), { type: 'refine-started', seq: 2 });
    const out = reduceDraftLifecycle(refining, replacement(2, 9, 'nowhere'));
    expect(out.phase).toBe('active');
    expect(out.content?.posts.map((p) => p.text)).toEqual(['one', 'two', 'three']);
    expect(out.pendingSeq).toBeNull();
  });

  it('the global one-level Undo reverses a scoped refine exactly', () => {
    const refined = [
      { type: 'refine-started', seq: 2 } as const,
      replacement(2, 2, 'three, but different'),
    ].reduce(reduceDraftLifecycle, activeThread());
    const undone = reduceDraftLifecycle(refined, { type: 'refine-undone' });
    expect(undone.content?.posts.map((p) => p.text)).toEqual(['one', 'two', 'three']);
  });
});
