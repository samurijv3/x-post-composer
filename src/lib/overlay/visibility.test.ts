import { describe, expect, it } from 'vitest';
import { decideOverlayVisibility, type OverlayStateInputs } from './visibility';

function inputs(overrides: Partial<OverlayStateInputs> = {}): OverlayStateInputs {
  return {
    panelOpen: true,
    captureMode: 'reply-context',
    xModalOpen: false,
    awayFromLockPath: false,
    hasLockTarget: true,
    hoveringTweet: false,
    ...overrides,
  };
}

describe('decideOverlayVisibility', () => {
  it('paints nothing when the panel is closed, whatever else is true', () => {
    const v = decideOverlayVisibility(inputs({ panelOpen: false, hoveringTweet: true }));
    expect(v).toEqual({ showLock: false, showPreview: false });
  });

  it('paints nothing while X has a modal layer open', () => {
    const v = decideOverlayVisibility(inputs({ xModalOpen: true, hoveringTweet: true }));
    expect(v).toEqual({ showLock: false, showPreview: false });
  });

  it('shows the lock highlight in reply-context mode with a lock target', () => {
    expect(decideOverlayVisibility(inputs()).showLock).toBe(true);
  });

  it('hides the lock highlight outside reply-context mode (mode-off hides, lock persists)', () => {
    expect(decideOverlayVisibility(inputs({ captureMode: 'none' })).showLock).toBe(false);
    expect(decideOverlayVisibility(inputs({ captureMode: 'library' })).showLock).toBe(false);
  });

  it('hides the lock highlight when there is no lock target', () => {
    expect(decideOverlayVisibility(inputs({ hasLockTarget: false })).showLock).toBe(false);
  });

  it('suppresses the lock highlight while away from the lock path (§6) without touching preview', () => {
    const v = decideOverlayVisibility(inputs({ awayFromLockPath: true, hoveringTweet: true }));
    expect(v.showLock).toBe(false);
    expect(v.showPreview).toBe(true);
  });

  it('restores the lock highlight on returning to the lock path (modal URL round-trips)', () => {
    // X's Reply modal pushes /compose/post and pops back on close — the
    // away flag must be derived from the current path, so this verdict
    // flips back to visible when the path returns.
    expect(decideOverlayVisibility(inputs({ awayFromLockPath: true })).showLock).toBe(false);
    expect(decideOverlayVisibility(inputs({ awayFromLockPath: false })).showLock).toBe(true);
  });

  it('shows the hover preview in either capture mode', () => {
    expect(
      decideOverlayVisibility(inputs({ captureMode: 'library', hoveringTweet: true })).showPreview,
    ).toBe(true);
    expect(
      decideOverlayVisibility(inputs({ captureMode: 'reply-context', hoveringTweet: true }))
        .showPreview,
    ).toBe(true);
  });

  it('hides the preview when no capture mode is active or nothing is hovered', () => {
    expect(
      decideOverlayVisibility(inputs({ captureMode: 'none', hoveringTweet: true })).showPreview,
    ).toBe(false);
    expect(decideOverlayVisibility(inputs({ hoveringTweet: false })).showPreview).toBe(false);
  });
});
