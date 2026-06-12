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
  getCaptureBundleTarget,
  getSettings,
  updateBundle,
  updateItem,
} from '../../src/storage';
import type { LibraryItem, RawCapture } from '../../src/types';
import type { RawThreadCapture } from '../../src/types/capture';
import { joinSegments, parseThreadSegments } from '../../src/lib/thread';
import { classifyType, validateAuthor } from '../../src/lib/voice';
import { findLibraryDuplicate, mergeLibraryDuplicate } from '../../src/lib/library';
import { appendBundleMember } from '../../src/lib/bundles';

/** A duplicate found within this window of the existing record's
 *  creation is treated as the same save gesture (double-click) and
 *  reported as the success it was. Comfortably above double-click
 *  speed, comfortably below a deliberate re-capture. */
const JUST_SAVED_GRACE_MS = 5000;

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
    segments: null,
    embedding: null,
    createdAt: Date.now(),
  };

  // The capture-mode bundle target (Phase 6): while set, every save —
  // fresh or dedupe-merged — also files into that bundle, and the
  // banner says so.
  const bundleTarget = await getCaptureBundleTarget();

  // Dedupe per Core Concept A: a handpick of an already-present tweet
  // WINS — it updates the existing record in place (promoting shipped/
  // archive rows to 'manual') and never inserts a duplicate. Identity
  // and precedence live in lib/library (tested).
  const existing = findLibraryDuplicate(await getAllItems(), {
    statusId: capture.statusId,
    text: capture.text,
  });
  if (existing) {
    // The pre-merge source is what the banner explains ("matches your
    // shipped draft"); the merge below may promote it to 'manual'.
    const priorSource = existing.source;
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    // Filing an already-saved tweet is the point of capturing with a
    // target — the promotion gesture grows the bundle.
    const filedInto = await fileIntoBundle(bundleTarget, existing.id);
    // A capture landing seconds after the record was created is the
    // same gesture twice (a double-click) — report the success it was,
    // idempotently, instead of scolding "already in your voice" over a
    // save that just worked.
    if (Date.now() - existing.createdAt < JUST_SAVED_GRACE_MS) {
      await broadcastNotice({
        type: 'bg:save-result',
        kind: capture.hasMedia ? 'text-media' : 'success',
        itemId: existing.id,
        ...(merged.type !== 'thread' && { itemType: merged.type }),
        ...(filedInto !== null && { filedIntoBundleName: filedInto }),
      });
      return;
    }
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: existing.id,
      duplicateOfSource: priorSource,
      ...(filedInto !== null && { filedIntoBundleName: filedInto }),
    });
    return;
  }

  const outcome = await tryAddItem(item);
  if (outcome === 'duplicate') {
    // The id collided under a concurrent write the scan above didn't
    // see — that only happens when the same tweet was inserted moments
    // ago (an older row would have matched the scan by id), i.e. the
    // double-click race. The tweet is saved; report success.
    await broadcastNotice({
      type: 'bg:save-result',
      kind: capture.hasMedia ? 'text-media' : 'success',
      itemId: item.id,
      itemType,
    });
    return;
  }

  const filedInto = await fileIntoBundle(bundleTarget, item.id);
  await broadcastNotice({
    type: 'bg:save-result',
    kind: capture.hasMedia ? 'text-media' : 'success',
    itemId: item.id,
    itemType,
    ...(filedInto !== null && { filedIntoBundleName: filedInto }),
  });
  await broadcastNotice({ type: 'bg:library-changed' });
}

/**
 * Thread capture (Phase 10): a self-reply spine walked on its /status/
 * page, persisted as ONE atomic thread item. Same author filter and
 * dedupe as single captures; the record id is the ROOT's status id
 * when readable. The banner carries the honest rendered-segment count.
 */
export async function handleCapturedThread(capture: RawThreadCapture): Promise<void> {
  const settings = await getSettings();
  if (settings.handle.trim() === '' || !validateAuthor(capture.authorHandle, settings.handle)) {
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'not-mine',
      rejectedAuthor: capture.authorHandle,
    });
    return;
  }

  const rootStatusId = capture.segments[0]?.statusId ?? null;
  const joined = joinSegments(capture.segments.map((s) => s.text));
  const item: LibraryItem = {
    id: rootStatusId ?? crypto.randomUUID(),
    text: joined,
    type: 'thread',
    segments: capture.segments,
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

  const bundleTarget = await getCaptureBundleTarget();
  // Identity: try the whole thread first (root id / joined text), then
  // EACH segment — so a fuller re-capture finds and upgrades an
  // earlier PARTIAL capture of the same thread (whose record id is a
  // different segment's status id), and a previously hand-captured
  // single segment promotes into the thread instead of duplicating.
  const items = await getAllItems();
  let existing = findLibraryDuplicate(items, { statusId: rootStatusId, text: joined });
  if (!existing) {
    for (const segment of capture.segments) {
      existing = findLibraryDuplicate(items, {
        statusId: segment.statusId,
        text: segment.text,
      });
      if (existing) break;
    }
  }
  if (existing) {
    const priorSource = existing.source;
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    const filedInto = await fileIntoBundle(bundleTarget, existing.id);
    if (Date.now() - existing.createdAt < JUST_SAVED_GRACE_MS) {
      await broadcastNotice({
        type: 'bg:save-result',
        kind: capture.hasMedia ? 'text-media' : 'success',
        itemId: existing.id,
        threadSegmentCount: capture.segments.length,
        ...(filedInto !== null && { filedIntoBundleName: filedInto }),
      });
      return;
    }
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: existing.id,
      duplicateOfSource: priorSource,
      ...(filedInto !== null && { filedIntoBundleName: filedInto }),
    });
    return;
  }

  await addItem(item);
  const filedInto = await fileIntoBundle(bundleTarget, item.id);
  await broadcastNotice({
    type: 'bg:save-result',
    kind: capture.hasMedia ? 'text-media' : 'success',
    itemId: item.id,
    threadSegmentCount: capture.segments.length,
    ...(filedInto !== null && { filedIntoBundleName: filedInto }),
  });
  await broadcastNotice({ type: 'bg:library-changed' });
}

export async function handleManualAdd(
  text: string,
  itemType: 'post' | 'reply' | 'thread',
  bundleId: string | null,
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
  // A pasted thread arrives in the --- wire format; fewer than two
  // parsed segments is an honest error, never a silent single save.
  const segments = itemType === 'thread' ? parseThreadSegments(trimmed) : null;
  if (segments !== null && segments.length < 2) {
    return {
      type: 'bg:add-manual-result',
      ok: false,
      message: 'A thread needs at least two posts — separate them with a line containing only ---.',
    };
  }
  const item: LibraryItem = {
    id: crypto.randomUUID(),
    text: segments !== null ? joinSegments(segments) : trimmed,
    type: itemType,
    source: 'manual',
    authorHandle: settings.handle.replace(/^@/, '').trim(),
    // Manual paste has no DOM source for these — the row renders without
    // an avatar and shows the handle only. Pasted segments carry no
    // status ids for the same reason.
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: new Date().toISOString(),
    engagement: null,
    favorite: false,
    segments: segments?.map((segment) => ({ text: segment, statusId: null })) ?? null,
    embedding: null,
    createdAt: Date.now(),
  };
  // Same dedupe as capture: pasting text that is already in the
  // library refreshes the existing record (manual outranks everything)
  // instead of inserting a second copy.
  const existing = findLibraryDuplicate(await getAllItems(), { statusId: null, text: item.text });
  if (existing) {
    // Read the source BEFORE merging — it decides the banner wording.
    const preMergeSource = existing.source;
    const merged = mergeLibraryDuplicate(existing, item);
    if (merged !== existing) {
      await updateItem(merged);
      await broadcastNotice({ type: 'bg:library-changed' });
    }
    const filedInto = await fileIntoBundle(bundleId, existing.id);
    // Manual adds share the capture flows' floating banner so every
    // save outcome lands in the same slot — a fresh result (this one
    // included) supersedes any lingering earlier banner.
    await broadcastNotice({
      type: 'bg:save-result',
      kind: 'duplicate',
      duplicateOfId: existing.id,
      duplicateOfSource: preMergeSource,
      ...(filedInto !== null ? { filedIntoBundleName: filedInto } : {}),
    });
    return {
      type: 'bg:add-manual-result',
      ok: true,
      message: `Already in your voice — refreshed the existing entry${
        filedInto !== null ? ` and filed it into “${filedInto}”` : ''
      }.`,
      itemId: existing.id,
    };
  }

  await addItem(item);
  await broadcastNotice({ type: 'bg:library-changed' });
  const filedInto = await fileIntoBundle(bundleId, item.id);
  await broadcastNotice({
    type: 'bg:save-result',
    kind: 'success',
    itemId: item.id,
    itemType,
    ...(segments !== null ? { threadSegmentCount: segments.length } : {}),
    ...(filedInto !== null ? { filedIntoBundleName: filedInto } : {}),
  });
  return {
    type: 'bg:add-manual-result',
    ok: true,
    message: filedInto !== null ? `Added — filed into “${filedInto}”.` : 'Added.',
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
  segments: string[] | null,
  mode: 'post' | 'reply' | 'thread',
  bundleId: string | null,
): Promise<BackgroundReply> {
  const settings = await getSettings();
  const trimmed = text.trim();
  const handle = settings.handle.replace(/^@/, '').trim();
  if (!settings.saveShippedDrafts || trimmed === '' || handle === '') {
    return { type: 'bg:capture-ack', ok: false };
  }

  const item: LibraryItem = {
    // No status id exists at commit time — the tweets haven't been
    // posted yet (thread segments carry null ids for the same reason).
    // A later handpick of the published tweet text-matches this record
    // and promotes it to 'manual'.
    id: crypto.randomUUID(),
    text: trimmed,
    type: mode,
    segments: segments?.map((segment) => ({ text: segment, statusId: null })) ?? null,
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
 * File a just-saved item into a bundle — shipped drafts into their
 * seeding bundle, captures/pastes into the capture-mode target. A
 * deleted bundle skips silently (eligibility, not error — the save
 * already succeeded; there is just nothing left to file into).
 * Already-a-member is a no-op via `appendBundleMember`'s identity
 * return. Returns the bundle's name when the item is (now) a member,
 * so callers can say so in their banners; null when nothing applied.
 */
async function fileIntoBundle(bundleId: string | null, itemId: string): Promise<string | null> {
  if (bundleId === null) return null;
  const bundle = await getBundle(bundleId);
  if (bundle === null) return null;
  const grown = appendBundleMember(bundle, itemId);
  if (grown !== bundle) {
    await updateBundle(grown);
    await broadcastNotice({ type: 'bg:bundles-changed' });
  }
  return bundle.name;
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
