import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('sidepanel root element missing');

/**
 * Long-lived port to the background worker, used as a presence signal:
 * while a panel port is connected, the background tells content scripts
 * the panel is open so they may paint overlays on x.com.
 *
 * MV3 detail that shapes this code: the service worker is shut down
 * after ~30s of inactivity, and an OPEN port does not prevent that —
 * only *messages* reset the idle timer (Chrome 114+). A silent port
 * would let the worker die mid-session, dropping the port and leaving
 * every tab's panel-open state stale. So:
 *   - a heartbeat message every 20s keeps the worker (and its port
 *     set) alive for exactly as long as a panel is open;
 *   - onDisconnect reconnects after a short delay, covering worker
 *     crashes and extension reloads while the panel stays open.
 */
const HEARTBEAT_MS = 20_000;
const RECONNECT_DELAY_MS = 500;

function connectPanelPort(): void {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: 'margin-panel' });
  } catch {
    // Extension runtime is gone (update/uninstall). Nothing to signal.
    return;
  }
  const heartbeat = window.setInterval(() => {
    try {
      port.postMessage('hb');
    } catch {
      // Port already dead; onDisconnect below handles reconnection.
    }
  }, HEARTBEAT_MS);
  port.onDisconnect.addListener(() => {
    window.clearInterval(heartbeat);
    window.setTimeout(connectPanelPort, RECONNECT_DELAY_MS);
  });
}
connectPanelPort();

createRoot(container).render(
  <StrictMode>
    <App surface="panel" />
  </StrictMode>,
);
