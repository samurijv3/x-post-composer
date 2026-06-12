import { useEffect, useState } from 'react';
import {
  getCaptureMode,
  setCaptureBundleTarget,
  setCaptureMode,
  subscribeCaptureBundleTarget,
  subscribeCaptureMode,
} from '../../storage';
import type { Bundle } from '../../types';
import { BundleTargetSelect } from './BundleTargetSelect';

interface CaptureBannerProps {
  handle: string;
  bundles: Bundle[];
  /** Mint an empty bundle inline (the select's "+ New bundle…"). */
  onCreateBundle: (name: string) => Promise<string | null>;
}

/** The "Saving from X" capture-mode toggle at the top of the Voice screen. */
export function CaptureBanner({ handle, bundles, onCreateBundle }: CaptureBannerProps) {
  const [mode, setMode] = useState<'none' | 'library' | 'reply-context'>('none');
  // The optional capture target (Phase 6): saves also file into this
  // bundle. Session storage, read by the background at capture time.
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    void getCaptureMode().then(setMode);
    const unsub = subscribeCaptureMode(setMode);
    const unsubTarget = subscribeCaptureBundleTarget(setTarget);
    return () => {
      unsub();
      unsubTarget();
    };
  }, []);
  const on = mode === 'library';

  // A target whose bundle was deleted resets to plain capture rather
  // than silently filing into nothing. Gated on a non-empty list: on
  // mount the bundles prop is [] until the screen's fetch resolves,
  // and a valid stored target must survive that window. (Zero bundles
  // also hides the select below, and the background validates the
  // target at capture time regardless.)
  useEffect(() => {
    if (target !== null && bundles.length > 0 && !bundles.some((b) => b.id === target)) {
      void setCaptureBundleTarget(null);
    }
  }, [target, bundles]);

  async function toggle(): Promise<void> {
    // The target deliberately SURVIVES the toggle: browsing for
    // examples means flipping capture off and on repeatedly, and
    // re-picking the bundle every time was the friction (changed
    // 2026-06-12; it used to clear here). Never silent when it
    // matters — the banner shows the target whenever the switch is
    // on, and every save states "Filed into …". Closing the panel
    // is the reset point (the background clears it on last-panel
    // close); a deleted bundle resets it too.
    await setCaptureMode(on ? 'none' : 'library');
  }

  return (
    <div className={`capt-row ${on ? 'on' : ''}`}>
      <span className="capt-dot" />
      <div className="capt-main">
        <div className="capt-title">{on ? 'Saving from X' : 'Save tweets from X'}</div>
        <div className="capt-sub">
          {on ? (
            <>
              Click your posts on x.com ·{' '}
              <BundleTargetSelect
                label="filing into"
                bundles={bundles}
                value={target}
                onChange={(id) => void setCaptureBundleTarget(id)}
                onCreateBundle={onCreateBundle}
              />
            </>
          ) : handle ? (
            `Click your own posts on x.com to save them. Only @${handle}’s writing gets in.`
          ) : (
            <>
              Set your handle in{' '}
              <button
                type="button"
                className="textlink"
                onClick={() => void chrome.runtime.openOptionsPage()}
              >
                Settings → Account
              </button>{' '}
              first.
            </>
          )}
        </div>
      </div>
      <label
        className="switch"
        title={
          !handle
            ? 'Set your handle first'
            : on
              ? 'Stop saving from X'
              : 'Click your posts on x.com and they’ll land here'
        }
      >
        <input type="checkbox" checked={on} disabled={!handle} onChange={() => void toggle()} />
        <span className="track" />
      </label>
    </div>
  );
}
