import { useEffect, useState } from 'react';
import { getCaptureMode, setCaptureMode, subscribeCaptureMode } from '../../storage';

/** The "Saving from X" capture-mode toggle at the top of the Voice screen. */
export function CaptureBanner({ handle }: { handle: string }) {
  const [mode, setMode] = useState<'none' | 'library' | 'reply-context'>('none');
  useEffect(() => {
    void getCaptureMode().then(setMode);
    const unsub = subscribeCaptureMode(setMode);
    return () => unsub();
  }, []);
  const on = mode === 'library';

  async function toggle(): Promise<void> {
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
    </div>
  );
}
