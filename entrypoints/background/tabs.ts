/**
 * Talking to x.com tabs: broadcasting state pushes to every tab's
 * content script, and the request/response round-trip that asks the
 * active tab to read the open composer's reply context.
 */
import type { BackgroundReply, BackgroundToContent } from '../../src/messaging';
import type { ReplyContext } from '../../src/types';

export const X_HOSTS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*',
];

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
