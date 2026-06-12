import { useEffect, useState } from 'react';
import {
  getCaptureMode,
  setCaptureBundleTarget,
  setCaptureMode,
  subscribeCaptureBundleTarget,
  subscribeCaptureMode,
} from '../../storage';
import type { Bundle } from '../../types';

/** The "Saving from X" capture-mode toggle at the top of the Voice screen. */
export function CaptureBanner({ handle, bundles }: { handle: string; bundles: Bundle[] }) {
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
  // than silently filing into nothing.
  useEffect(() => {
    if (target !== null && !bundles.some((b) => b.id === target)) {
      void setCaptureBundleTarget(null);
    }
  }, [target, bundles]);

  async function toggle(): Promise<void> {
    // Mode and target live and die together — turning capture off
    // clears the target so the next session starts plain.
    if (on) await setCaptureBundleTarget(null);
    await setCaptureMode(on ? 'none' : 'library');
  }

  return (
    <div className={`capture-banner ${on ? 'on' : ''}`}>
      <div className="cb-top">
        <span className="cb-dot" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{on ? 'Saving from X' : 'Save tweets from X'}</div>
          <p className="help" style={{ marginTop: 1 }}>
            {on
              ? 'Click your posts on x.com and they’ll land here.'
              : handle
                ? `Click your own posts on x.com to save them. Only @${handle}’s writing gets in.`
                : 'Set your handle in Settings → Account first.'}
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={() => void toggle()} />
          <span className="track track-ok" />
        </label>
      </div>
      {on && bundles.length > 0 && (
        <label className="bundle-pick cb-target">
          <span className="fld-label">Also file into</span>
          <select
            value={target ?? ''}
            onChange={(e) =>
              void setCaptureBundleTarget(e.target.value === '' ? null : e.target.value)
            }
            title="Captured tweets also join this bundle — one pass on X builds the series"
          >
            <option value="">— just the library</option>
            {bundles.map((b) => (
              <option key={b.id} value={b.id}>
                Bundle: {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
