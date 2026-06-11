import { describe, expect, it } from 'vitest';
import type { Span } from '../exclusion';
import {
  INITIAL_DRAFT_LIFECYCLE,
  reduceDraftLifecycle,
  type DraftEvent,
  type DraftLifecycleState,
} from './lifecycle';

function span(): Span {
  return { start: 0, end: 1, rule: 'emDash', matchedText: '—' };
}

/** Run a sequence of events from the initial state. */
function run(...events: DraftEvent[]): DraftLifecycleState {
  return events.reduce(reduceDraftLifecycle, INITIAL_DRAFT_LIFECYCLE);
}

const modelDraft = (text: string, violations: Span[] = []) => ({
  text,
  residualViolations: violations,
  wasRepaired: false,
});

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
    expect(active.content?.text).toBe('hello');
    expect(active.content?.handEdited).toBe(false);
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
    expect(after2.content?.text).toBe('fresh');

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
    expect(fromActive.content?.text).toBe('keep me');
  });

  it('a regenerate keeps the outgoing draft visible, then opens the timed-undo window', () => {
    const regenerating = reduceDraftLifecycle(activeWith('old'), {
      type: 'generation-started',
      seq: 2,
    });
    expect(regenerating.phase).toBe('generating');
    expect(regenerating.content?.text).toBe('old'); // still on screen

    const replaced = reduceDraftLifecycle(regenerating, {
      type: 'generation-succeeded',
      seq: 2,
      draft: modelDraft('new'),
    });
    expect(replaced.content?.text).toBe('new');
    expect(replaced.replaced?.text).toBe('old'); // undo can bring it back
  });
});

describe('hand edits', () => {
  it('clear residual violations and mark the draft hand-edited — exclusions are bypassed', () => {
    const edited = reduceDraftLifecycle(activeWith('draft — text', [span()]), {
      type: 'hand-edited',
      text: 'my own words',
    });
    expect(edited.content?.text).toBe('my own words');
    expect(edited.content?.residualViolations).toEqual([]);
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
    const touched = reduceDraftLifecycle(replaced, { type: 'hand-edited', text: 'new + me' });
    expect(touched.replaced).toBeNull();
  });

  it('un-commit a committed draft — edits ride through the next copy', () => {
    const committed = reduceDraftLifecycle(activeWith(), { type: 'committed' });
    const edited = reduceDraftLifecycle(committed, { type: 'hand-edited', text: 'revised' });
    expect(edited.phase).toBe('active');
  });

  it('do NOT clear the one-level refine snapshot (it must survive)', () => {
    const refined = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('original') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('refined') },
    );
    const edited = reduceDraftLifecycle(refined, { type: 'hand-edited', text: 'refined + me' });
    expect(edited.refineSnapshot?.text).toBe('original');

    const undone = reduceDraftLifecycle(edited, { type: 'refine-undone' });
    expect(undone.content?.text).toBe('original');
    expect(undone.refineSnapshot).toBeNull();
  });

  it('are no-ops while generating or empty', () => {
    expect(run({ type: 'hand-edited', text: 'x' }).phase).toBe('empty');
    const generating = run({ type: 'generation-started', seq: 1 });
    expect(reduceDraftLifecycle(generating, { type: 'hand-edited', text: 'x' })).toBe(generating);
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
    expect(refined.content?.text).toBe('refined');
    expect(refined.replaced).toBeNull(); // not a replacement
    expect(refined.refineSnapshot?.text).toBe('original');
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
    expect(undone.content?.text).toBe('old');
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
    expect(expired.content?.text).toBe('new');
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
    expect(refined.refineSnapshot?.text).toBe('v1'); // refine undo live
    const regenerated = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('v1') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('v2') },
      { type: 'generation-started', seq: 3 },
      { type: 'generation-succeeded', seq: 3, draft: modelDraft('v3') },
    );
    expect(regenerated.replaced?.text).toBe('v2'); // timed undo live
    expect(regenerated.refineSnapshot).toBeNull(); // refine chain ended
  });
});

describe('new context', () => {
  it('clears an active draft into the timed-undo window and empties the workbench', () => {
    const cleared = reduceDraftLifecycle(activeWith('reply to old tweet'), {
      type: 'new-context',
    });
    expect(cleared.phase).toBe('empty');
    expect(cleared.content).toBeNull();
    expect(cleared.replaced?.text).toBe('reply to old tweet');

    const undone = reduceDraftLifecycle(cleared, { type: 'replacement-undone' });
    expect(undone.phase).toBe('active');
    expect(undone.content?.text).toBe('reply to old tweet');
  });

  it('invalidates an in-flight generation — its result was for the old context', () => {
    const state = run(
      { type: 'generation-started', seq: 1 },
      { type: 'new-context' },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('for the old context') },
    );
    expect(state.phase).toBe('empty');
    expect(state.content).toBeNull();
  });

  it('is a no-op on an empty workbench', () => {
    expect(run({ type: 'new-context' })).toEqual(INITIAL_DRAFT_LIFECYCLE);
  });
});

describe('commit and discard', () => {
  it('commit moves active → committed and resolves both undo scopes', () => {
    const withBoth = run(
      { type: 'generation-started', seq: 1 },
      { type: 'generation-succeeded', seq: 1, draft: modelDraft('v1') },
      { type: 'refine-started', seq: 2 },
      { type: 'generation-succeeded', seq: 2, draft: modelDraft('v2') },
    );
    const committed = reduceDraftLifecycle(withBoth, { type: 'committed' });
    expect(committed.phase).toBe('committed');
    expect(committed.replaced).toBeNull();
    expect(committed.refineSnapshot).toBeNull();
    expect(committed.content?.text).toBe('v2');
  });

  it('commit is a no-op outside active', () => {
    expect(run({ type: 'committed' })).toEqual(INITIAL_DRAFT_LIFECYCLE);
    const generating = run({ type: 'generation-started', seq: 1 });
    expect(reduceDraftLifecycle(generating, { type: 'committed' })).toBe(generating);
  });

  it('a committed draft can be regenerated, with the timed undo guarding it', () => {
    const committed = reduceDraftLifecycle(activeWith('shipped'), { type: 'committed' });
    const replaced = reduceDraftLifecycle(
      reduceDraftLifecycle(committed, { type: 'generation-started', seq: 9 }),
      { type: 'generation-succeeded', seq: 9, draft: modelDraft('next take') },
    );
    expect(replaced.content?.text).toBe('next take');
    expect(replaced.replaced?.text).toBe('shipped');
  });

  it('discard resets everything', () => {
    const discarded = reduceDraftLifecycle(activeWith(), { type: 'discarded' });
    expect(discarded).toEqual(INITIAL_DRAFT_LIFECYCLE);
  });
});
