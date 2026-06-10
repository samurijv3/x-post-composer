/**
 * Library capture — validating a tweet captured on x.com (or pasted
 * manually) and persisting it as a LibraryItem. Content code never
 * touches the corpus; everything lands here first.
 */
import { broadcastNotice, type BackgroundReply } from '../../src/messaging';
import { addItem, getSettings } from '../../src/storage';
import type { LibraryItem, RawCapture } from '../../src/types';
import { classifyType, validateAuthor } from '../../src/lib/voice';

export async function handleCapturedTweet(capture: RawCapture): Promise<void> {
  const settings = await getSettings();
  if (settings.handle.trim() === '') {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'not-mine',
      rejectedAuthor: capture.authorHandle,
    });
    return;
  }

  if (!validateAuthor(capture.authorHandle, settings.handle)) {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'not-mine',
      rejectedAuthor: capture.authorHandle,
    });
    return;
  }

  const itemType = classifyType({
    hasReplyContextNode: capture.hasReplyContextNode,
    inReplyToStatusId: capture.inReplyToStatusId,
    isPrecededByParentArticle: capture.isPrecededByParentArticle,
  });

  const item: LibraryItem = {
    id: capture.statusId ?? crypto.randomUUID(),
    text: capture.text,
    type: itemType,
    source: 'capture',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    authorDisplayName: capture.authorDisplayName,
    authorAvatarUrl: capture.authorAvatarUrl,
    timestamp: capture.timestamp ?? new Date().toISOString(),
    engagement: null,
    embedding: null,
    createdAt: Date.now(),
  };

  const outcome = await tryAddItem(item);
  if (outcome === 'duplicate') {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: item.id,
    });
    return;
  }

  await broadcastNotice({
    type: 'bg:save-result',
    kind: capture.hasMedia ? 'text-media' : 'success',
    itemId: item.id,
    itemType,
  });
  await broadcastNotice({ type: 'bg:library-changed' });
}

export async function handleManualAdd(
  text: string,
  itemType: 'post' | 'reply',
): Promise<BackgroundReply> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { type: 'bg:add-manual-result', ok: false, message: 'Text is empty.' };
  }
  const settings = await getSettings();
  if (settings.handle.trim() === '') {
    return {
      type: 'bg:add-manual-result',
      ok: false,
      message: 'Set your X handle in the Account tab before adding items.',
    };
  }
  const item: LibraryItem = {
    id: crypto.randomUUID(),
    text: trimmed,
    type: itemType,
    source: 'manual',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    // Manual paste has no DOM source for these — the row renders without
    // an avatar and shows the handle only.
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: new Date().toISOString(),
    engagement: null,
    embedding: null,
    createdAt: Date.now(),
  };
  await addItem(item);
  await broadcastNotice({ type: 'bg:library-changed' });
  return {
    type: 'bg:add-manual-result',
    ok: true,
    message: 'Added.',
    itemId: item.id,
  };
}

async function tryAddItem(item: LibraryItem): Promise<'added' | 'duplicate'> {
  try {
    await addItem(item);
    return 'added';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') {
      return 'duplicate';
    }
    throw error;
  }
}

type SaveResultKind =
  | 'success'
  | 'text-media'
  | 'duplicate'
  | 'not-mine'
  | 'truncated'
  | 'media-only';

/**
 * Map a content-script failure reason onto a save-result banner kind.
 * `missing-text` / `missing-author` / `unknown` / `no-tweet-under-cursor`
 * don't map to any banner — they're edge cases the user can't really
 * act on, so we stay silent rather than surfacing a useless message.
 */
export function failureReasonToSaveResultKind(reason: string): SaveResultKind | null {
  if (reason === 'truncated') return 'truncated';
  if (reason === 'media-only') return 'media-only';
  return null;
}

/**
 * Reply-context-mode failures share kinds with save-result so the panel
 * can render reply-context-flavoured wording in the same banner chrome.
 */
export function replyContextFailureKind(reason: string): 'truncated' | 'media-only' | 'unknown' {
  if (reason === 'truncated') return 'truncated';
  if (reason === 'media-only') return 'media-only';
  return 'unknown';
}
