/**
 * Background service worker — wiring only.
 *
 * Responsibilities (CLAUDE.md §6):
 *   - Sole reader of the API key (via ./generation).
 *   - Sole caller of `api.anthropic.com` (via ./generation).
 *   - Routes typed messages between the side panel, content scripts,
 *     and the Anthropic client.
 *
 * The work lives in the sibling modules:
 *   - generation.ts — generate/refine pipeline + key verification
 *   - capture.ts    — library capture validation + persistence
 *   - tabs.ts       — pushing state to x.com tabs, composer round-trip
 */
import { defineBackground } from 'wxt/utils/define-background';
import { broadcastNotice, isMessageOfType, onMessage } from '../../src/messaging';
import {
  getCaptureMode,
  getReplyContextLock,
  setAutoReplyFlag,
  setCaptureBundleTarget,
  setReplyContextLock,
} from '../../src/storage';
import type { ReplyContext } from '../../src/types';
import { mergeReplyContextSelection } from '../../src/lib/replyContext';
import { runGeneration, runRefine, runVerifyKey } from './generation';
import {
  failureReasonToSaveResultKind,
  handleCapturedThread,
  handleCapturedTweet,
  handleManualAdd,
  handleShippedDraft,
  replyContextFailureKind,
} from './capture';
import {
  focusOrOpenXTab,
  isActiveTabOnX,
  pushToTabs,
  requestReplyContextFromActiveTab,
  sendCaptureNavToActiveTab,
} from './tabs';

/**
 * Set of currently-connected panel ports. The panel opens a port via
 * `chrome.runtime.connect({ name: 'margin-panel' })` on mount, and the
 * port closes automatically when the panel context is destroyed
 * (closed by the user, tab closed, etc.). We track the count so the
 * content script can suppress all overlays when no panel is open —
 * the highlight only makes sense when the user is actively in the
 * extension's UI.
 */
const openPanelPorts = new Set<chrome.runtime.Port>();

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('Failed to set side panel behavior', error);
  });

  // Keyboard shortcut: open the panel + auto-capture the reply context.
  // A storage flag covers the "panel not open yet" case; a broadcast
  // covers "panel already open." Both paths converge in the Composer.
  chrome.commands.onCommand.addListener((command, senderTab) => {
    if (command !== 'capture-reply-and-open') return;
    void handleAutoReplyCommand(senderTab);
  });

  // Panel-open tracking — see the comment on openPanelPorts.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'margin-panel') return;
    const wasOpen = openPanelPorts.size > 0;
    openPanelPorts.add(port);
    if (!wasOpen) void pushToTabs({ type: 'bg:panel-state', isOpen: true });
    // The panel heartbeats over this port every ~20s. Receiving the
    // message is the point: each one resets this worker's idle timer,
    // so the worker (and with it `openPanelPorts`) stays alive exactly
    // as long as a panel is open. The payload itself means nothing.
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => {
      openPanelPorts.delete(port);
      if (openPanelPorts.size === 0) {
        void pushToTabs({ type: 'bg:panel-state', isOpen: false });
        // The capture bundle target's lifetime is "while the panel is
        // open": it survives mode toggles (repeated off/on browsing
        // keeps the bundle choice) but closing the last panel resets
        // filing to plain library — a fresh panel starts unbiased.
        void setCaptureBundleTarget(null);
      }
    });
  });

  // Active-tab awareness for the panel's "go back to X" state. Both
  // listeners need no permissions; URLs of non-X pages stay invisible
  // to us (see isActiveTabOnX). Broadcasts only while a panel is open —
  // nobody else listens, so tab churn with the panel closed costs
  // nothing.
  const pushActiveTabState = (): void => {
    if (openPanelPorts.size === 0) return;
    void (async () => {
      await broadcastNotice({ type: 'bg:active-tab-state', onX: await isActiveTabOnX() });
    })();
  };
  chrome.tabs.onActivated.addListener(pushActiveTabState);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    // Only the active tab's navigations matter, and onUpdated fires for
    // plenty that isn't navigation (favicon, title, audible…).
    if (!tab.active) return;
    if (changeInfo.url === undefined && changeInfo.status === undefined) return;
    pushActiveTabState();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;

    const modeChange = changes['activeCaptureMode:v1'];
    if (modeChange) {
      const next = modeChange.newValue;
      const mode = next === 'library' || next === 'reply-context' ? next : 'none';
      void pushToTabs({ type: 'bg:capture-mode-state', mode });
    }

    const lockChange = changes['replyContextLock:v1'];
    if (lockChange) {
      const lock = (lockChange.newValue as ReplyContext | undefined) ?? null;
      void pushToTabs({ type: 'bg:reply-context-lock-state', lock });
    }
  });

  onMessage(async (message) => {
    if (isMessageOfType(message, 'panel:ping')) {
      return { type: 'bg:pong', receivedAt: Date.now() };
    }

    if (isMessageOfType(message, 'panel:verify-key')) {
      const result = await runVerifyKey();
      return { type: 'bg:verify-key-result', ok: result.ok, message: result.message };
    }

    if (isMessageOfType(message, 'panel:add-manual-item')) {
      return handleManualAdd(message.text, message.itemType, message.bundleId);
    }

    if (isMessageOfType(message, 'panel:capture-nav')) {
      // Fire-and-forget toward the active X tab; ack so the panel's
      // promise resolves. Nothing to report back — the page reacts.
      void sendCaptureNavToActiveTab(message.key, message.repeat);
      return { type: 'bg:capture-ack', ok: true };
    }

    if (isMessageOfType(message, 'content:captured-tweet')) {
      await handleCapturedTweet(message.payload);
      return { type: 'bg:capture-ack', ok: true };
    }

    if (isMessageOfType(message, 'content:captured-thread')) {
      await handleCapturedThread(message.payload);
      return { type: 'bg:capture-ack', ok: true };
    }

    if (isMessageOfType(message, 'content:capture-failed')) {
      const kind = failureReasonToSaveResultKind(message.reason);
      if (kind) {
        await broadcastNotice({
          type: 'bg:save-result',
          kind,
          ...(message.truncatedOrdinals !== undefined && {
            truncatedOrdinals: message.truncatedOrdinals,
          }),
        });
      }
      return { type: 'bg:capture-ack', ok: false };
    }

    if (isMessageOfType(message, 'content:reply-context-failed')) {
      await broadcastNotice({
        type: 'bg:reply-context-error',
        kind: replyContextFailureKind(message.reason),
      });
      return { type: 'bg:capture-ack', ok: false };
    }

    if (isMessageOfType(message, 'content:check-capture-mode')) {
      const mode = await getCaptureMode();
      return { type: 'bg:capture-mode-state', mode };
    }

    if (isMessageOfType(message, 'content:check-reply-context-lock')) {
      const lock = await getReplyContextLock();
      return { type: 'bg:reply-context-lock-state', lock };
    }

    if (isMessageOfType(message, 'content:check-panel-state')) {
      return { type: 'bg:panel-state', isOpen: openPanelPorts.size > 0 };
    }

    if (isMessageOfType(message, 'content:reply-context-selected')) {
      // The content script has already extracted target + grandparent +
      // status id. Persist as the active lock. Reply-context mode stays
      // ON deliberately so the user can hover other tweets and click
      // to swap the locked context without re-toggling the mode. They
      // turn it off in the panel when done. A re-delivery of the SAME
      // tweet (X's modal copies carry no author/status links) merges
      // into the existing lock instead of degrading it.
      const merged = mergeReplyContextSelection(await getReplyContextLock(), message.context);
      await setReplyContextLock(merged);
      return { type: 'bg:reply-context-lock-state', lock: merged };
    }

    if (isMessageOfType(message, 'content:dismiss-reply-context')) {
      await setReplyContextLock(null);
      return { type: 'bg:reply-context-lock-state', lock: null };
    }

    if (isMessageOfType(message, 'panel:generate')) {
      const result = await runGeneration(message.request);
      return { type: 'bg:generation-result', result };
    }

    if (isMessageOfType(message, 'panel:refine')) {
      const result = await runRefine(message.request);
      return { type: 'bg:generation-result', result };
    }

    if (isMessageOfType(message, 'panel:capture-reply-context')) {
      return await requestReplyContextFromActiveTab();
    }

    if (isMessageOfType(message, 'panel:check-active-tab')) {
      return { type: 'bg:active-tab-state', onX: await isActiveTabOnX() };
    }

    if (isMessageOfType(message, 'panel:draft-committed')) {
      return handleShippedDraft(message.text, message.segments, message.mode, message.bundleId);
    }

    if (isMessageOfType(message, 'panel:open-x-tab')) {
      await focusOrOpenXTab();
      // Focusing/creating an X tab makes it the active tab.
      return { type: 'bg:active-tab-state', onX: true };
    }

    return undefined;
  });
});

// ---------------------------------------------------------------------
// Keyboard shortcut handler
// ---------------------------------------------------------------------

async function handleAutoReplyCommand(senderTab: chrome.tabs.Tab | undefined): Promise<void> {
  let tab = senderTab;
  if (!tab?.id) {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active[0];
  }
  if (!tab?.id) return;

  // Open FIRST. sidePanel.open() may only run inside the user-gesture
  // window (Chrome 116+), and every await before it spends that budget.
  // The flag/broadcast consumers don't depend on ordering: a panel
  // opened by this call takes far longer to mount than the storage
  // write below takes to land.
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    // Some Chrome versions reject `open` outside a tight user-gesture
    // window; the user can fall back to the toolbar icon. Don't throw.
    console.error('Side panel open from shortcut failed', error);
  }

  // Flag and broadcast carry the SAME stamp so the panel can dedupe
  // the pair — a panel opened by this shortcut consumes the flag on
  // mount and then also receives the broadcast.
  const at = Date.now();
  await setAutoReplyFlag(at);
  // The broadcast covers the case where the panel was already open and
  // would otherwise miss the flag (it's checked on mount only).
  await broadcastNotice({ type: 'bg:auto-reply-capture', at });
}
