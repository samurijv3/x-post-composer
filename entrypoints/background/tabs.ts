/**
 * Talking to x.com tabs: broadcasting state pushes to every tab's
 * content script, the request/response round-trip that asks the
 * active tab to read the open composer's reply context, and the
 * active-tab-on-X probe behind the panel's "go back to X" state.
 */
import type { BackgroundReply, BackgroundToContent } from '../../src/messaging';
import { isXPageUrl } from '../../src/lib/url';
import type { ReplyContext } from '../../src/types';

/** Match-pattern twin of `isXPageUrl` (src/lib/url) — keep in sync. */
export const X_HOSTS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*',
];

/**
 * Whether the focused window's active tab is on X. Needs NO new
 * permissions: without the "tabs" permission, chrome populates
 * `tab.url` only for hosts in host_permissions (ours: X), so for any
 * other page the url is absent and `isXPageUrl(undefined)` is false —
 * exactly the answer we want, without ever seeing non-X URLs.
 */
export async function isActiveTabOnX(): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return isXPageUrl(tab?.url);
}

/**
 * Focus an existing X tab (preferring the current window) or open a
 * fresh one. Behind the off-X overlay's "Open x.com" button — runs only
 * on that explicit user click.
 */
export async function focusOrOpenXTab(): Promise<void> {
  const candidates = await chrome.tabs.query({ url: X_HOSTS });
  const current = await chrome.windows.getLastFocused();
  const target = candidates.find((t) => t.windowId === current.id) ?? candidates[0];
  if (target?.id !== undefined) {
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId !== undefined && target.windowId !== current.id) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: 'https://x.com/home' });
}

/** Fire-and-forget a message to every x.com tab that has our content script. */
export async function pushToTabs(message: BackgroundToContent): Promise<void> {
  const tabs = await chrome.tabs.query({ url: X_HOSTS });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Content script not present in this tab. Ignore.
      }
    }),
  );
}

export async function requestReplyContextFromActiveTab(): Promise<BackgroundReply> {
  const tab = await findActiveXTab();
  if (!tab?.id) {
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message: 'No x.com tab is open in this window.',
    };
  }
  try {
    const raw: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: 'bg:capture-reply-context-request',
    } satisfies BackgroundToContent);
    if (isReplyContextOk(raw)) {
      return { type: 'bg:reply-context-result', ok: true, context: raw.context };
    }
    if (isReplyContextErr(raw)) {
      return { type: 'bg:reply-context-result', ok: false, message: raw.message };
    }
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message: 'Content script returned an unexpected shape.',
    };
  } catch (error) {
    return {
      type: 'bg:reply-context-result',
      ok: false,
      message:
        error instanceof Error
          ? `Could not reach the x.com tab: ${error.message}`
          : 'Could not reach the x.com tab.',
    };
  }
}

async function findActiveXTab(): Promise<chrome.tabs.Tab | undefined> {
  const active = await chrome.tabs.query({
    url: X_HOSTS,
    active: true,
    currentWindow: true,
  });
  if (active[0]) return active[0];
  const any = await chrome.tabs.query({ url: X_HOSTS });
  return any[0];
}

function isReplyContextOk(raw: unknown): raw is { ok: true; context: ReplyContext } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { ok?: unknown }).ok === true &&
    typeof (raw as { context?: unknown }).context === 'object'
  );
}

function isReplyContextErr(raw: unknown): raw is { ok: false; message: string } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { ok?: unknown }).ok === false &&
    typeof (raw as { message?: unknown }).message === 'string'
  );
}
