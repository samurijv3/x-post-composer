import { useEffect, useState } from 'react';
import {
  clearApiKey,
  getSettings,
  hasApiKey,
  migrateApiKey,
  setApiKey,
  setSettings,
  type KeyStorageMode,
} from '../../storage';
import { sendToBackground, type BackgroundReply } from '../../messaging';
import { IcCheck, IcKey, IcShield } from '../icons';

interface Props {
  onSaved: () => void;
}

/**
 * Account section: handle + API key + key storage mode + verify.
 * This section uses an EXPLICIT Save button (it holds a secret) —
 * the other sections in the options page apply immediately.
 *
 * The key field is WRITE-ONLY (CLAUDE.md §6): the stored value is never
 * read back into page state or the DOM. The UI knows only whether a key
 * is set; replacing means pasting a new one, removing means Clear.
 */
export function AccountSection({ onSaved }: Props) {
  const [handle, setHandle] = useState<string>('');
  const [keyInput, setKeyInput] = useState<string>('');
  const [keyIsSet, setKeyIsSet] = useState<boolean>(false);
  const [keyMode, setKeyMode] = useState<KeyStorageMode>('local');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [savedFlag, setSavedFlag] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await getSettings();
      const isSet = await hasApiKey(settings.keyStorageMode);
      if (cancelled) return;
      setHandle(settings.handle);
      setKeyMode(settings.keyStorageMode);
      setKeyIsSet(isSet);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAccount(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await setSettings({ handle: handle.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Persist the storage-mode choice and, when a new key was pasted,
   * the key itself. A blank input keeps the existing key (it is never
   * shown, so blank means "unchanged", not "remove" — removal is the
   * explicit Clear button).
   */
  async function saveKey(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const settings = await getSettings();
      if (settings.keyStorageMode !== keyMode) {
        // Carries an existing key to the new area when the input is blank.
        await migrateApiKey(settings.keyStorageMode, keyMode);
        await setSettings({ keyStorageMode: keyMode });
      }
      const next = keyInput.trim();
      if (next !== '') {
        await setApiKey(keyMode, next);
        setKeyInput('');
        setKeyIsSet(true);
      }
      setVerifyResult(null);
      setSavedFlag(true);
      window.setTimeout(() => setSavedFlag(false), 1600);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function removeKey(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await clearApiKey();
      setKeyIsSet(false);
      setKeyInput('');
      setVerifyResult(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed.');
    } finally {
      setSaving(false);
    }
  }

  async function verify(): Promise<void> {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:verify-key-result' }>
      >({ type: 'panel:verify-key' });
      setVerifyResult({ ok: reply.ok, text: reply.message });
    } catch (err) {
      setVerifyResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Verify failed.',
      });
    } finally {
      setVerifying(false);
    }
  }

  if (!loaded) return <div className="opt-card">Loading…</div>;

  // Verify checks the SAVED key; while the input holds an unsaved key
  // the result would be misleading, so it is disabled until saved.
  const keyDirty = keyInput.trim() !== '';
  const canVerify = keyIsSet && !keyDirty && !verifying;

  return (
    <div className="opt-stack">
      <div className="opt-card">
        <div className="opt-card-title">Your X account</div>
        <p className="opt-card-desc">
          The hard filter for saving — only posts from this handle can join your voice.
        </p>
        <label className="fld" style={{ maxWidth: 320 }}>
          <span className="fld-label">X handle</span>
          <div className="input-prefixed">
            <span className="ip-prefix">@</span>
            <input
              type="text"
              value={handle}
              placeholder="yourhandle"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
              onBlur={() => void saveAccount()}
            />
          </div>
        </label>
      </div>

      <div className="opt-card">
        <div className="opt-card-title">Anthropic API key</div>
        <p className="opt-card-desc">
          Write-only here: the saved key is read by the background worker alone — never shown back,
          never injected into the X page, never logged.
        </p>
        <div className="opt-grid-2">
          <label className="fld">
            <span className="fld-label">API key</span>
            <input
              type="password"
              value={keyInput}
              placeholder={keyIsSet ? 'Key is set — paste a new one to replace' : 'sk-ant-…'}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          </label>
          <label className="fld">
            <span className="fld-label">Where to keep it</span>
            <select value={keyMode} onChange={(e) => setKeyMode(e.target.value as KeyStorageMode)}>
              <option value="local">Persistent — survives restarts</option>
              <option value="session">Session only — cleared on quit</option>
            </select>
          </label>
        </div>
        <div className="callout warn" style={{ marginTop: 14 }}>
          <IcShield />
          <span>
            <strong>Set a spend cap first.</strong> Your key is stored unencrypted, protected by
            your OS account and the extension sandbox. A leak is bounded to API spend and revocable
            in seconds.
          </span>
        </div>
        <div className="pillrow" style={{ marginTop: 4 }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => void saveKey()}
            disabled={saving}
          >
            {savedFlag ? (
              <>
                <IcCheck /> Saved
              </>
            ) : saving ? (
              'Saving…'
            ) : (
              'Save key'
            )}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void verify()}
            disabled={!canVerify}
            title={
              keyDirty
                ? 'Save the pasted key first — Verify checks the SAVED key.'
                : 'Checks the saved key with a tiny Anthropic request (max_tokens: 8).'
            }
          >
            <IcKey /> {verifying ? 'Verifying…' : 'Verify'}
          </button>
          {keyIsSet && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void removeKey()}
              disabled={saving}
              title="Remove the saved key from this browser (both storage areas)"
            >
              Clear key
            </button>
          )}
          {verifyResult && (
            <span className={`status ${verifyResult.ok ? 'ok' : 'err'}`}>
              {verifyResult.ok ? (
                <>
                  <IcCheck /> Key works
                </>
              ) : (
                verifyResult.text
              )}
            </span>
          )}
        </div>
        {error && (
          <div className="status err" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
