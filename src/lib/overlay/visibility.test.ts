import { describe, expect, it } from 'vitest';
import { decideOverlayVisibility, type OverlayStateInputs } from './visibility';

function inputs(overrides: Partial<OverlayStateInputs> = {}): OverlayStateInputs {
  return {
    panelOpen: true,
    captureMode: 'reply-context',
    xModalOpen: false,
    hasLockTarget: true,
    hoveringTweet: false,
    hoveredInModal: false,
    ...overrides,
  };
}

describe('decideOverlayVisibility', () => {
  it('paints nothing when the panel is closed, whatever else is true', () => {
    const v = decideOverlayVisibility(inputs({ panelOpen: false, hoveringTweet: true }));
    expect(v).toEqual({ showLock: false, showPreview: false });
  });

  it('while a modal is open, the preview follows only modal-resident tweets', () => {
    // Hovering the timeline under the scrim: nothing. Hovering the
    // tweet inside the reply dialog / lightbox: normal preview.
    expect(
      decideOverlayVisibility(inputs({ xModalOpen: true, hoveringTweet: true })).showPreview,
    ).toBe(false);
    expect(
      decideOverlayVisibility(
        inputs({ xModalOpen: true, hoveringTweet: true, hoveredInModal: true }),
      ).showPreview,
    ).toBe(true);
  });

  it('the lock may paint whenever mode + lock exist — modal or not', () => {
    // Layer discipline lives in the shell's scoped article search, not
    // here: the verdict allows painting; the search decides where.
    expect(decideOverlayVisibility(inputs()).showLock).toBe(true);
    expect(decideOverlayVisibility(inputs({ xModalOpen: true })).showLock).toBe(true);
  });

  it('hides the lock highlight outside reply-context mode (mode-off hides, lock persists)', () => {
    expect(decideOverlayVisibility(inputs({ captureMode: 'none' })).showLock).toBe(false);
    expect(decideOverlayVisibility(inputs({ captureMode: 'library' })).showLock).toBe(false);
  });

  it('hides the lock highlight when there is no lock', () => {
    expect(decideOverlayVisibility(inputs({ hasLockTarget: false })).showLock).toBe(false);
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
