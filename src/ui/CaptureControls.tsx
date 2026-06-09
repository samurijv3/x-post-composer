import { useEffect, useState } from 'react';
import { getCaptureMode, setCaptureMode, subscribeCaptureMode } from '../storage';
import { isMessageOfType, onNotice } from '../messaging';

interface Toast {
  ok: boolean;
  message: string;
  /** Used as key to re-trigger CSS animation if reused later. */
  stamp: number;
}

/**
 * Side-panel-only controls: toggle capture mode and surface each
 * capture's outcome as a transient toast. Capture mode lives in
 * `chrome.storage.session` so it never survives a full browser quit
 * and the content script learns about toggles via storage events.
 */
export function CaptureControls() {
  const [active, setActive] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCaptureMode().then((value) => {
      if (cancelled) return;
      setActive(value);
      setLoaded(true);
    });
    const unsubMode = subscribeCaptureMode((value) => {
      if (cancelled) return;
      setActive(value);
    });
    const unsubNotice = onNotice((notice) => {
      if (!isMessageOfType(notice, 'bg:capture-notice')) return;
      setToast({ ok: notice.ok, message: notice.message, stamp: Date.now() });
    });
    return () => {
      cancelled = true;
      unsubMode();
      unsubNotice();
    };
  }, []);

  async function toggle(): Promise<void> {
    await setCaptureMode(!active);
  }

  return (
    <div className="capture-controls">
      <button
        type="button"
        className={`capture-toggle ${active ? 'on' : 'off'}`}
        onClick={() => void toggle()}
        disabled={!loaded}
        aria-pressed={active}
      >
        {active ? 'Capture mode: ON — click your tweets' : 'Turn on capture mode'}
      </button>
      <p className="help">
        While ON, clicks on tweet bodies on x.com are intercepted (X won&apos;t navigate) and the
        tweet is sent here. Only tweets authored by your configured handle are saved.
      </p>
      {toast && (
        <div className={`status ${toast.ok ? 'ok' : 'err'}`} key={toast.stamp}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
