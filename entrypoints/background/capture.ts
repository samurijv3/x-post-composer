/**
 * Library capture — validating a tweet captured on x.com (or pasted
 * manually) and persisting it as a LibraryItem. Content code never
 * touches the corpus; everything lands here first.
 */
import { broadcastNotice, type BackgroundReply } from '../../src/messaging';
import {
  addItem,
  getAllItems,
  getBundle,
  getSettings,
  updateBundle,
  updateItem,
} from '../../src/storage';
import type { LibraryItem, RawCapture } from '../../src/types';
import { classifyType, validateAuthor } from '../../src/lib/voice';
import { findLibraryDuplicate, mergeLibraryDuplicate } from '../../src/lib/library';
import { appendBundleMember } from '../../src/lib/bundles';

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
    // A one-click capture is a handpick — Core Concept A 'manual'.
    source: 'manual',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    authorDisplayName: capture.authorDisplayName,
    authorAvatarUrl: capture.authorAvatarUrl,
    timestamp: capture.timestamp ?? new Date().toISOString(),
    engagement: null,
    favorite: false,
    embedding: null,
    createdAt: Date.now(),
  };

  // Dedupe per Core Concept A: a handpick of an already-present tweet
  // WINS — it updates the existing record in place (promoting shipped/
  // archive rows to 'manual') and never inserts a duplicate. Identity
  // and precedence live in lib/library (tested).
  const existing = findLibraryDuplicate(await getAllItems(), {
    statusId: capture.statusId,
    text: capture.text,
  });
  if (existing) {
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: existing.id,
    });
    return;
  }

  const outcome = await tryAddItem(item);
  if (outcome === 'duplicate') {
    // Safety net: the id collided under a concurrent write the scan
    // above didn't see.
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
    favorite: false,
    embedding: null,
    createdAt: Date.now(),
  };
  // Same dedupe as capture: pasting text that is already in the
  // library refreshes the existing record (manual outranks everything)
  // instead of inserting a second copy.
  const existing = findLibraryDuplicate(await getAllItems(), { statusId: null, text: trimmed });
  if (existing) {
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    return {
      type: 'bg:add-manual-result',
      ok: true,
      message: 'Already in your voice — refreshed the existing entry.',
      itemId: existing.id,
    };
  }

  await addItem(item);
  await broadcastNotice({ type: 'bg:library-changed' });
  return {
    type: 'bg:add-manual-result',
    ok: true,
    message: 'Added.',
    itemId: item.id,
  };
}

/**
 * The Phase 4 corpus loop: a committed (copied-to-X) draft enters the
 * library as a `source: 'shipped'` example. Eligibility, not errors —
 * a disabled setting or a missing handle skips silently (the user's
 * copy already succeeded; this is downstream bookkeeping). Dedupe: a
 * re-copy or an already-present text never inserts a second row, and
 * shipped never downgrades a manual record.
 *
 * Bundle auto-filing (Phase 6): when the draft was seeded by a bundle
 * AND the shipped save persists (same eligibility — a skipped save
 * files nothing), the saved item appends to that bundle, making it a
 * living template for the series. A deduped re-copy files the EXISTING
 * record's id; an already-member id is a no-op.
 */
export async function handleShippedDraft(
  text: string,
  mode: 'post' | 'reply',
  bundleId: string | null,
): Promise<BackgroundReply> {
  const settings = await getSettings();
  const trimmed = text.trim();
  const handle = settings.handle.replace(/^@/, '').trim();
  if (!settings.saveShippedDrafts || trimmed === '' || handle === '') {
    return { type: 'bg:capture-ack', ok: false };
  }

  const item: LibraryItem = {
    // No status id exists at commit time — the tweet hasn't been
    // posted yet. A later handpick of the published tweet text-matches
    // this record and promotes it to 'manual'.
    id: crypto.randomUUID(),
    text: trimmed,
    type: mode,
    source: 'shipped',
    authorHandle: handle,
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: new Date().toISOString(),
    engagement: null,
    favorite: false,
    embedding: null,
    createdAt: Date.now(),
  };

  const existing = findLibraryDuplicate(await getAllItems(), { statusId: null, text: trimmed });
  if (existing) {
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    await fileIntoBundle(bundleId, existing.id);
    return { type: 'bg:capture-ack', ok: true };
  }

  await addItem(item);
  await broadcastNotice({ type: 'bg:library-changed' });
  await fileIntoBundle(bundleId, item.id);
  return { type: 'bg:capture-ack', ok: true };
}

/**
 * Append a freshly-shipped item to the bundle that seeded its draft. A
 * deleted bundle skips silently (eligibility, not error — the copy and
 * the shipped save both already succeeded; there is just nothing left
 * to file into). Already-a-member is a no-op via `appendBundleMember`'s
 * identity return.
 */
async function fileIntoBundle(bundleId: string | null, itemId: string): Promise<void> {
  if (bundleId === null) return;
  const bundle = await getBundle(bundleId);
  if (bundle === null) return;
  const grown = appendBundleMember(bundle, itemId);
  if (grown === bundle) return;
  await updateBundle(grown);
  await broadcastNotice({ type: 'bg:bundles-changed' });
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
  | 'media-only'
  | 'unreadable';

/**
 * Map a content-script failure reason onto a save-result banner kind.
 * Extraction failures (`missing-text` / `missing-author` / `unknown` —
 * usually X markup drift) surface as a generic "couldn't read that
 * tweet" banner: the user clicked and deserves a response, and the
 * banner points them at the manual-paste fallback. Only
 * `no-tweet-under-cursor` stays silent — it genuinely means the click
 * wasn't on a tweet.
 */
export function failureReasonToSaveResultKind(reason: string): SaveResultKind | null {
  if (reason === 'truncated') return 'truncated';
  if (reason === 'media-only') return 'media-only';
  if (reason === 'no-tweet-under-cursor') return null;
  return 'unreadable';
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
