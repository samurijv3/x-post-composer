import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import { Toast, type ToastData } from './Toast';
import { IcCompose, IcMoon, IcSettings, IcSun, IcVoice } from './icons';
import {
  bindDocumentTheme,
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '../storage';
import { ComposeScreen } from './ComposeScreen';
import { VoiceScreen, type FlashRow } from './VoiceScreen';
import { OptionsPage } from './OptionsPage';
import { SaveResultBanner, SAVE_META, type SaveResult } from './SaveResultBanner';
import { ReplyContextErrorBanner, type ReplyContextError } from './ReplyContextErrorBanner';
import { getSettings } from '../storage';
import { isMessageOfType, onNotice, sendToBackground, type BackgroundReply } from '../messaging';
import './styles.css';

type Screen = 'compose' | 'voice';

interface AppProps {
  /** 'panel' renders the side panel; 'options' renders the full-page settings view. */
  surface: 'panel' | 'options';
}

export function App({ surface }: AppProps) {
  // Bind the resolved theme to <html data-theme> at mount, on every
  // surface. Cleanup on unmount (test/StrictMode safety).
  useEffect(() => bindDocumentTheme(), []);

  if (surface === 'options') {
    return <OptionsPage />;
  }
  return <PanelShell />;
}

function PanelShell() {
  const [screen, setScreen] = useState<Screen>('compose');
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastTimer = useRef<number | null>(null);
  // The save-result banner state lives here (panel-shell level) so the
  // banner floats at the top of the viewport across screens.
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  // Reply-context-mode failures use the same floating-banner slot.
  // Mutually exclusive with saveResult — whichever notice arrives last
  // wins so the user never sees two stacked banners.
  const [replyContextError, setReplyContextError] = useState<ReplyContextError | null>(null);
  const [handle, setHandle] = useState<string>('');
  // VoiceScreen reads this to flash a specific row: 'added' for a fresh
  // save, 'locate' when something asks to reveal a specific row —
  // the duplicate banner's "Show me" or a bundle-member click (which also
  // scrolls the row into view). Cleared after the flash window.
  const [flashRow, setFlashRow] = useState<FlashRow | null>(null);
  const flashTimer = useRef<number | null>(null);
  const stampRef = useRef<number>(0);

  const fireFlash = useCallback((id: string, kind: FlashRow['kind']) => {
    setFlashRow({ id, kind });
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    // Matches the 2.3s flash animations in styles.css.
    flashTimer.current = window.setTimeout(() => setFlashRow(null), 2300);
  }, []);

  const fireToast = useCallback((message: string, action?: ToastData['action']) => {
    setToast({ message, action, stamp: Date.now() });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 5200 : 1800);
  }, []);

  // Settings handle for the "not-mine" message.
  useEffect(() => {
    void getSettings().then((s) => setHandle(s.handle));
  }, []);

  // ---- "go back to X" overlay state ----
  // null = unknown (nothing shows until the background answers). The
  // background pushes bg:active-tab-state on tab switch/navigation
  // while a panel is open; we fetch once on mount to seed it.
  const [onX, setOnX] = useState<boolean | null>(null);
  // "Compose anyway" hides the overlay for this off-X stint; returning
  // to X re-arms it so the next stray navigation shows it again.
  const [offXDismissed, setOffXDismissed] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    sendToBackground<Extract<BackgroundReply, { type: 'bg:active-tab-state' }>>({
      type: 'panel:check-active-tab',
    })
      .then((reply) => {
        if (!cancelled) setOnX(reply.onX);
      })
      .catch(() => {
        // Background unreachable — leave state unknown; show nothing.
      });
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:active-tab-state')) setOnX(notice.onX);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  useEffect(() => {
    if (onX) setOffXDismissed(false);
  }, [onX]);

  function openX(): void {
    sendToBackground({ type: 'panel:open-x-tab' }).catch(() => {
      // Couldn't reach the background; the overlay simply stays.
    });
  }

  // Save-result notice: hoist into the floating banner. Replaces the
  // previous in-Voice rendering so the banner is visible from any
  // screen without scroll-jumping the user.
  useEffect(() => {
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:save-result')) {
        stampRef.current += 1;
        setSaveResult({
          kind: notice.kind,
          rejectedAuthor: notice.rejectedAuthor,
          duplicateOfId: notice.duplicateOfId,
          itemType: notice.itemType,
          stamp: stampRef.current,
        });
        // Mutex: a new save-result clears any lingering reply-context
        // banner so the two never stack.
        setReplyContextError(null);
        if (notice.kind === 'success' && notice.itemId) {
          fireFlash(notice.itemId, 'added');
        }
        return;
      }
      // Reply-context-mode failures use the same floating slot as the
      // save-result banner — only the wording differs. Setting one
      // clears the other so the user only ever sees one floating
      // banner at a time.
      if (isMessageOfType(notice, 'bg:reply-context-error')) {
        stampRef.current += 1;
        setReplyContextError({ kind: notice.kind, stamp: stampRef.current });
        setSaveResult(null);
      }
    });
    return () => unsub();
  }, [fireFlash]);

  // Auto-dismiss every floating banner after a short period. Success
  // clears faster ("got it, move on"); warnings/errors linger a bit
  // longer so the user has time to read the message and click an
  // action if there is one.
  useEffect(() => {
    if (!saveResult || !SAVE_META[saveResult.kind].autodismiss) return;
    const ms = saveResult.kind === 'success' ? 4500 : 6500;
    const t = window.setTimeout(() => setSaveResult(null), ms);
    return () => window.clearTimeout(t);
  }, [saveResult]);

  useEffect(() => {
    if (!replyContextError) return;
    const t = window.setTimeout(() => setReplyContextError(null), 6500);
    return () => window.clearTimeout(t);
  }, [replyContextError]);

  // Note: we deliberately do NOT auto-switch to Voice on capture — the
  // floating banner makes any screen valid for surfacing the result.

  function openOptions(): void {
    void chrome.runtime.openOptionsPage();
  }

  function showDup(id: string): void {
    setScreen('voice');
    fireFlash(id, 'locate');
  }

  return (
    <div className="panel">
      <PanelHead screen={screen} onSwitchScreen={setScreen} onOpenOptions={openOptions} />
      <div className="panel-body">
        {(saveResult || replyContextError) && (
          <div className="floating-banner-slot">
            {saveResult && (
              <SaveResultBanner
                result={saveResult}
                handle={handle}
                onDismiss={() => setSaveResult(null)}
                onShowDup={showDup}
              />
            )}
            {replyContextError && (
              <ReplyContextErrorBanner
                error={replyContextError}
                onDismiss={() => setReplyContextError(null)}
              />
            )}
          </div>
        )}
        {screen === 'compose' && <ComposeScreen onToast={fireToast} onOpenOptions={openOptions} />}
        {screen === 'voice' && (
          <VoiceScreen
            onToast={fireToast}
            flashRow={flashRow}
            onLocateItem={(id) => fireFlash(id, 'locate')}
          />
        )}
      </div>
      {onX === false && !offXDismissed && (
        <div className="offx-overlay" role="status">
          <div className="offx-card">
            <div className="offx-title">You’ve left X</div>
            <p className="help" style={{ margin: '4px 0 12px' }}>
              Margin works alongside an x.com tab — capturing tweets and pulling in reply context
              need you there.
            </p>
            <div className="offx-actions">
              <button type="button" className="btn primary sm" onClick={openX}>
                Open x.com
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setOffXDismissed(true)}>
                Compose anyway
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  );
}

interface HeadProps {
  screen: Screen;
  onSwitchScreen: (s: Screen) => void;
  onOpenOptions: () => void;
}

function PanelHead({ screen, onSwitchScreen, onOpenOptions }: HeadProps) {
  return (
    <div className="panel-head">
      <div className="brand">
        <BrandMark />
        <div>
          <div className="brand-name">Margin</div>
          <div className="brand-sub">in the margin of X</div>
        </div>
      </div>
      <span className="head-spacer" />
      <button
        className="icon-btn"
        type="button"
        title={screen === 'voice' ? 'Compose' : 'Voice'}
        aria-label={screen === 'voice' ? 'Switch to Compose' : 'Switch to Voice'}
        onClick={() => onSwitchScreen(screen === 'voice' ? 'compose' : 'voice')}
      >
        {screen === 'voice' ? <IcCompose /> : <IcVoice />}
      </button>
      <ThemeToggle />
      <button
        className="icon-btn"
        type="button"
        title="Settings"
        aria-label="Open settings"
        onClick={onOpenOptions}
      >
        <IcSettings />
      </button>
    </div>
  );
}

/**
 * Binary theme toggle. Shows the icon of the *opposite* theme (the
 * one a click would switch to) — sun = "switch to light", moon =
 * "switch to dark." Matches every other extension's theme button.
 */
function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>('light');
  useEffect(() => {
    void getThemePreference().then(setPref);
    const unsub = subscribeTheme(setPref);
    return () => unsub();
  }, []);
  function toggle(): void {
    void setThemePreference(pref === 'dark' ? 'light' : 'dark');
  }
  const title = pref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button className="icon-btn" type="button" title={title} aria-label={title} onClick={toggle}>
      {pref === 'dark' ? <IcSun /> : <IcMoon />}
    </button>
  );
}
