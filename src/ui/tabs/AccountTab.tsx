import { useEffect, useState } from 'react';
import {
  getApiKey,
  getSettings,
  migrateApiKey,
  setApiKey,
  setSettings,
  type KeyStorageMode,
} from '../../storage';
import { sendToBackground, type BackgroundReply } from '../../messaging';

/**
 * The only functional settings tab in Chunk 1. Lets the user enter their
 * X handle, their Anthropic API key, and pick where the key lives.
 *
 * The frank risk note next to the key field comes from CLAUDE.md §6 — it
 * stays in plain sight, not behind a tooltip.
 */
export function AccountTab() {
  const [handle, setHandle] = useState<string>('');
  const [apiKey, setApiKeyLocal] = useState<string>('');
  const [keyMode, setKeyMode] = useState<KeyStorageMode>('local');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyResult, setVerifyResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const settings = await getSettings();
      const storedKey = await getApiKey(settings.keyStorageMode);
      if (cancelled) return;
      setHandle(settings.handle);
      setKeyMode(settings.keyStorageMode);
      setApiKeyLocal(storedKey);
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Round-trips to the background worker which reads the saved key
   * from storage and pings Anthropic with `max_tokens: 1`. The key
   * never leaves background; this UI only sees the ok/error message.
   */
  async function onVerify(): Promise<void> {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:verify-key-result' }>
      >({ type: 'panel:verify-key' });
      setVerifyResult({ kind: reply.ok ? 'ok' : 'err', text: reply.message });
    } catch (error) {
      setVerifyResult({
        kind: 'err',
        text: error instanceof Error ? error.message : 'Verify failed.',
      });
    } finally {
      setVerifying(false);
    }
  }

  async function onSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const settings = await getSettings();
      // If the user flipped the key storage mode, move any existing key
      // before persisting the new value so we never end up with a key in
      // both areas at once.
      if (settings.keyStorageMode !== keyMode) {
        await migrateApiKey(settings.keyStorageMode, keyMode);
      }
      await setSettings({ handle: handle.trim(), keyStorageMode: keyMode });
      await setApiKey(keyMode, apiKey);
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (error) {
      setStatus({
        kind: 'err',
        text: error instanceof Error ? error.message : 'Save failed.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="stub">Loading…</div>;
  }

  return (
    <form className="tab-panel" onSubmit={onSave}>
      <div className="field">
        <label htmlFor="handle">Your X handle</label>
        <input
          id="handle"
          type="text"
          value={handle}
          placeholder="yourhandle (no @)"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
        />
        <div className="help">
          Used as the hard filter when capturing tweets later — only your own writing enters the
          library.
        </div>
      </div>

      <div className="field">
        <label htmlFor="apiKey">Anthropic API key</label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setApiKeyLocal(e.target.value)}
        />
        <div className="risk-box">
          <strong>Heads up.</strong> Your key is stored unencrypted in this browser&apos;s
          extension storage, protected by your OS account and the extension sandbox. The blast
          radius of a leak is bounded to API spend and is fully revocable. <strong>Please set
          a spend cap on your key</strong> in the Anthropic console before using this extension.
        </div>
      </div>

      <div className="field">
        <label htmlFor="keyMode">Where to keep the key</label>
        <select
          id="keyMode"
          value={keyMode}
          onChange={(e) => setKeyMode(e.target.value as KeyStorageMode)}
        >
          <option value="local">
            Persistent (chrome.storage.local) — survives browser restarts
          </option>
          <option value="session">
            Session only (chrome.storage.session) — cleared when you fully quit the browser
          </option>
        </select>
      </div>

      <div className="row">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => void onVerify()}
          disabled={verifying || apiKey === ''}
          title="Calls Anthropic with max_tokens: 1 to confirm the saved key works"
        >
          {verifying ? 'Verifying…' : 'Verify key'}
        </button>
      </div>
      {status && <div className={`status ${status.kind}`}>{status.text}</div>}
      {verifyResult && (
        <div className={`status ${verifyResult.kind}`}>{verifyResult.text}</div>
      )}
    </form>
  );
}
