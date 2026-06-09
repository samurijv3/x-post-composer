/**
 * Thin request/response + broadcast wrappers around `chrome.runtime`.
 *
 * Three sender shapes:
 *   - `sendToBackground` — panel awaits a typed reply.
 *   - `sendOneWay`       — content fires and forgets; rejection ignored.
 *   - `broadcastNotice`  — background pushes a notice to whoever listens.
 *
 * One receiver shape per role:
 *   - `onMessage`        — background handles requests + returns replies.
 *   - `onNotice`         — panel/options receive background broadcasts.
 */
import type {
  AnyMessage,
  BackgroundNotice,
  BackgroundReply,
  ContentToBackground,
  PanelToBackground,
} from './contracts';
import { isBackgroundNotice } from './contracts';

/**
 * Panel → background request. Resolves with the typed reply.
 * Rejects when the background returns a `bg:error` or the runtime
 * channel itself fails (e.g. background not registered).
 */
export async function sendToBackground<TReply extends BackgroundReply>(
  message: PanelToBackground,
): Promise<TReply> {
  const reply = (await chrome.runtime.sendMessage(message)) as TReply | undefined;
  if (!reply) {
    throw new Error('Background worker returned no response');
  }
  if (reply.type === 'bg:error') {
    throw new Error(reply.message);
  }
  return reply;
}

/**
 * Fire-and-forget send from a content script. Rejections are swallowed
 * because the background may not have responded by the time the page
 * navigates — the content side has no UI to surface errors anyway.
 *
 * Wrapped in try/catch because `chrome.runtime.sendMessage` can throw
 * SYNCHRONOUSLY when the extension's runtime has been torn down (the
 * common "Extension context invalidated" case after an extension
 * reload while the page is still open). A synchronous throw escapes a
 * trailing `.catch()`; the explicit try/catch makes it benign.
 */
export function sendOneWay(message: ContentToBackground): void {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {
      // No-op: the receiver may have torn down. Capture failures should
      // never throw inside the page.
    });
  } catch {
    // Runtime is dead (orphaned content script). Nothing to do.
  }
}

/**
 * Background → all extension surfaces (panel, options). Silently no-ops
 * when no surface is open to receive.
 */
export async function broadcastNotice(notice: BackgroundNotice): Promise<void> {
  try {
    await chrome.runtime.sendMessage(notice);
  } catch {
    // Receiver may not exist (panel closed). Drop the notice.
  }
}

/**
 * Background-side request handler. Return a `BackgroundReply` (or a
 * promise of one) to reply; return `undefined` to ignore. Thrown errors
 * are converted to a `bg:error` reply so the sender's promise rejects
 * with a clean message instead of timing out.
 */
export function onMessage(
  handler: (
    message: AnyMessage,
    sender: chrome.runtime.MessageSender,
  ) => Promise<BackgroundReply | undefined> | BackgroundReply | undefined,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let result: Promise<BackgroundReply | undefined> | BackgroundReply | undefined;
    try {
      result = handler(message as AnyMessage, sender);
    } catch (error) {
      sendResponse({
        type: 'bg:error',
        message: error instanceof Error ? error.message : 'Background handler threw',
      });
      return false;
    }
    if (result === undefined) return false;
    Promise.resolve(result)
      .then((reply) => {
        if (reply === undefined) {
          sendResponse({ type: 'bg:error', message: 'Handler returned no reply' });
        } else {
          sendResponse(reply);
        }
      })
      .catch((error: unknown) => {
        sendResponse({
          type: 'bg:error',
          message: error instanceof Error ? error.message : 'Background handler rejected',
        });
      });
    return true;
  });
}

/**
 * Panel/options → listen for background notices. Returns an unsubscribe.
 */
export function onNotice(handler: (notice: BackgroundNotice) => void): () => void {
  const listener = (message: unknown): void => {
    if (isBackgroundNotice(message)) handler(message);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
