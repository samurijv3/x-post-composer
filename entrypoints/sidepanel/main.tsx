import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('sidepanel root element missing');

/**
 * Open a long-lived port to the background worker. The port's only
 * purpose is liveness signalling: while it's open, the background
 * knows a panel is alive; when the panel context is destroyed (user
 * closes the panel, tab closes), the port's onDisconnect fires in
 * the background reliably. The background uses this to push
 * `bg:panel-state` to content scripts so they can suppress on-page
 * overlays whenever the panel isn't actually open.
 *
 * No messages flow over this port — it's a presence signal only.
 */
chrome.runtime.connect({ name: 'margin-panel' });

createRoot(container).render(
  <StrictMode>
    <App surface="panel" />
  </StrictMode>,
);
