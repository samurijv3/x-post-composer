import { useCallback, useEffect, useState } from 'react';
import {
  addBundle,
  addItem,
  deleteBundle,
  deleteItem,
  getAllBundles,
  getAllItems,
  getSettings,
  updateBundle,
  updateItem,
} from '../storage';
import { isMessageOfType, onNotice, sendToBackground, type BackgroundReply } from '../messaging';
import { moveBundleMember } from '../lib/bundles';
import { matchesSearch } from '../lib/library';
import type { Bundle, LibraryItem } from '../types';
import { IcChevDown, IcChevR, IcPlus, IcSearch, IcVoice } from './icons';
import type { ToastData } from './Toast';
import { AddForm } from './voice/AddForm';
import { BundleSection } from './voice/BundleSection';
import { CaptureBanner } from './voice/CaptureBanner';
import { LibRow } from './voice/LibRow';

/** Row App wants flashed: 'added' after a successful save, 'locate'
 *  when something asks to reveal a specific row — the duplicate
 *  banner's "Show me" or a bundle-member link (scrolls too). */
export interface FlashRow {
  id: string;
  kind: 'added' | 'locate';
}

interface Props {
  onToast: (msg: string, action?: ToastData['action']) => void;
  flashRow: FlashRow | null;
  /** Ask App (which owns the flash state) to reveal a library row.
   *  Bundle-member links reuse the duplicate-banner "Show me" path:
   *  scroll into view + flash; the filter widens below. */
  onLocateItem: (id: string) => void;
}

type TypeFilter = 'all' | 'post' | 'reply' | 'thread';

/**
 * Voice — the saved-examples library. Owns the list state and storage
 * round-trips; the banner, rows, and add-form live in ./voice.
 */
export function VoiceScreen({ onToast, flashRow, onLocateItem }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [handle, setHandle] = useState<string>('');
  // Two filter AXES, mirroring the data model (type is exclusive,
  // the star is orthogonal). Plain click = exclusive select (resets
  // the other axis); ⌘/Ctrl-click = combine (set only the clicked
  // axis) — so ★ + one type shows e.g. starred threads.
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [starredOnly, setStarredOnly] = useState<boolean>(false);
  // Live search over the examples — filters as you type, composed with
  // the pill filter (visible = pill ∩ query).
  const [query, setQuery] = useState<string>('');
  const [adding, setAdding] = useState<boolean>(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  // ---- bundles (roadmap Phase 6) ----
  const [bundles, setBundles] = useState<Bundle[]>([]);
  // Bundle-building selection mode: pickedIds is in SELECTION order —
  // that order is the bundle's stored member order. The destination is
  // an existing bundle's id that the picks append to, or null for a
  // brand-new bundle (named below).
  const [picking, setPicking] = useState<boolean>(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [bundleName, setBundleName] = useState<string>('');
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  // The two screen sections collapse independently; both default open.
  const [bundlesOpen, setBundlesOpen] = useState<boolean>(true);
  const [examplesOpen, setExamplesOpen] = useState<boolean>(true);

  // A locate promised to show THE row — if a type filter or a collapsed
  // section would hide it, the flash would be invisible and the link
  // would read as broken. Widen to All and open the section first.
  // (Just-added flashes don't override either; they didn't ask to jump.)
  useEffect(() => {
    if (flashRow?.kind === 'locate') {
      setFilter('all');
      setStarredOnly(false);
      setQuery('');
      setExamplesOpen(true);
    }
  }, [flashRow]);

  const refresh = useCallback(async () => {
    try {
      const all = await getAllItems();
      all.sort((a, b) => b.createdAt - a.createdAt);
      setItems(all);
    } catch {
      setItems([]);
    }
  }, []);

  const refreshBundles = useCallback(async () => {
    try {
      const all = await getAllBundles();
      all.sort((a, b) => b.createdAt - a.createdAt);
      setBundles(all);
    } catch {
      setBundles([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshBundles();
    void getSettings().then((s) => setHandle(s.handle));
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:library-changed')) void refresh();
      // Auto-filing (the background appending a shipped draft to its
      // seeding bundle) is the one bundle write that happens outside
      // this screen — follow it live.
      if (isMessageOfType(notice, 'bg:bundles-changed')) void refreshBundles();
    });
    return () => unsub();
  }, [refresh, refreshBundles]);

  // Pills and search compose: the query whittles first, the pill picks
  // a slice of the matches. The pill COUNTS follow the query (faceted —
  // they show how the matches split across types), but the starred
  // pill's VISIBILITY and the stuck-filter reset follow the whole
  // library, so typing can't blink the pill away or yank the filter.
  const starredTotal = items.filter((i) => i.favorite).length;
  const threadsTotal = items.filter((i) => i.type === 'thread').length;
  const searchFiltered = items.filter((i) => matchesSearch(i.text, query));
  // Each chip's count answers "what would I see with this chip ON,
  // given the other axis" — the faceted-search semantics extended to
  // the star combo.
  const starBase = starredOnly ? searchFiltered.filter((i) => i.favorite) : searchFiltered;
  const posts = starBase.filter((i) => i.type === 'post').length;
  const replies = starBase.filter((i) => i.type === 'reply').length;
  const threads = starBase.filter((i) => i.type === 'thread').length;
  // The visible starred count IS the control: it nudges toward a small
  // canon (Core Concept A) — deliberately no ranking or bulk tools.
  const typeBase =
    filter === 'all' ? searchFiltered : searchFiltered.filter((i) => i.type === filter);
  const starred = typeBase.filter((i) => i.favorite).length;
  const visible = starredOnly ? typeBase.filter((i) => i.favorite) : typeBase;

  // Plain click selects exclusively; ⌘/Ctrl-click changes one axis and
  // keeps the other (re-⌘-clicking the active value toggles it off).
  function clickType(next: TypeFilter, combine: boolean): void {
    if (combine) {
      setFilter(filter === next ? 'all' : next);
    } else {
      setFilter(next);
      setStarredOnly(false);
    }
  }
  function clickStar(combine: boolean): void {
    if (combine) {
      setStarredOnly(!starredOnly);
    } else {
      setStarredOnly(!(starredOnly && filter === 'all'));
      setFilter('all');
    }
  }

  // The starred pill disappears when the last star is removed — don't
  // leave the filter stuck on a state with no control to escape it.
  useEffect(() => {
    if (starredOnly && starredTotal === 0) setStarredOnly(false);
    if (filter === 'thread' && threadsTotal === 0) setFilter('all');
  }, [filter, starredOnly, starredTotal, threadsTotal]);

  async function remove(item: LibraryItem): Promise<void> {
    await deleteItem(item.id);
    onToast('Removed', {
      label: 'Undo',
      onClick: () => {
        void (async () => {
          try {
            await addItem(item);
            await refresh();
          } catch {
            onToast('Could not restore.');
          }
        })();
      },
    });
    await refresh();
  }

  async function patchItem(id: string, patch: Partial<LibraryItem>): Promise<void> {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    await updateItem({ ...target, ...patch });
    onToast('Changes saved');
    await refresh();
  }

  function toggleRow(id: string): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const visibleIds = visible.map((i) => i.id);
  const allOpen = visibleIds.length > 0 && visibleIds.every((id) => openIds.has(id));
  function toggleAll(): void {
    setOpenIds(allOpen ? new Set() : new Set(visibleIds));
  }

  // ---- bundle handlers ----
  function togglePick(id: string): void {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function startPicking(target: string | null = null): void {
    setPicking(true);
    setPickTarget(target);
    // Picking needs both sections: the create bar lives in Bundles,
    // the pick targets are the examples list.
    setBundlesOpen(true);
    setExamplesOpen(true);
  }

  function stopPicking(): void {
    setPicking(false);
    setPickedIds([]);
    setBundleName('');
    setPickTarget(null);
  }

  function retargetPicks(target: string | null): void {
    setPickTarget(target);
    // Picks that are already members of the new destination would be
    // silently dropped at save — prune them now so the count is honest
    // (their rows flip to the locked check).
    if (target !== null) {
      const memberIds = bundles.find((b) => b.id === target)?.memberIds ?? [];
      setPickedIds((prev) => prev.filter((id) => !memberIds.includes(id)));
    }
  }

  // The destination decides what Save needs: a new bundle needs a name
  // (picks optional — an empty bundle is a valid start, filled from X
  // via the capture target); appending to an existing one needs picks.
  const canSavePicks = pickTarget === null ? bundleName.trim() !== '' : pickedIds.length > 0;

  async function savePicks(): Promise<void> {
    if (!canSavePicks) return;
    try {
      if (pickTarget === null) {
        const name = bundleName.trim();
        await addBundle({
          id: crypto.randomUUID(),
          name,
          memberIds: pickedIds,
          createdAt: Date.now(),
        });
        onToast(
          pickedIds.length === 0
            ? `Bundle “${name}” created — fill it anytime`
            : `Bundle “${name}” saved`,
        );
      } else {
        const target = bundles.find((b) => b.id === pickTarget);
        if (!target) {
          onToast('That bundle no longer exists.');
          stopPicking();
          return;
        }
        const fresh = pickedIds.filter((id) => !target.memberIds.includes(id));
        await updateBundle({ ...target, memberIds: [...target.memberIds, ...fresh] });
        onToast(
          `Added ${fresh.length} ${fresh.length === 1 ? 'tweet' : 'tweets'} to “${target.name}”`,
        );
      }
      stopPicking();
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save the bundle.');
    }
  }

  // Inline minting for the "+ New bundle…" option in the filing
  // selects (capture banner, paste form): an empty bundle, ready to be
  // a target. Returns the id so the caller can select it, null on
  // failure (already toasted).
  async function createEmptyBundle(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (trimmed === '') return null;
    try {
      const id = crypto.randomUUID();
      await addBundle({ id, name: trimmed, memberIds: [], createdAt: Date.now() });
      onToast(`Bundle “${trimmed}” created`);
      await refreshBundles();
      return id;
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create the bundle.');
      return null;
    }
  }

  async function renameBundle(bundle: Bundle, name: string): Promise<void> {
    try {
      await updateBundle({ ...bundle, name });
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not rename the bundle.');
    }
  }

  async function removeBundleMember(bundle: Bundle, itemId: string): Promise<void> {
    try {
      await updateBundle({ ...bundle, memberIds: bundle.memberIds.filter((id) => id !== itemId) });
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update the bundle.');
    }
  }

  async function moveMember(
    bundle: Bundle,
    itemId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    // One visible step: the pure move skips dangling ids, so the swap
    // partner is always the neighbor the user can actually see.
    const moved = moveBundleMember(bundle, itemId, direction, new Set(items.map((i) => i.id)));
    if (moved === bundle) return;
    try {
      await updateBundle(moved);
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not reorder the bundle.');
    }
  }

  async function removeBundle(bundle: Bundle): Promise<void> {
    try {
      await deleteBundle(bundle.id);
      onToast('Bundle deleted', {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              await addBundle(bundle);
              await refreshBundles();
            } catch {
              onToast('Could not restore.');
            }
          })();
        },
      });
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not delete the bundle.');
    }
  }

  // Manual add — dedupe locally then send to background which saves.
  // Background broadcasts the save-result notice on success/dup, which
  // App.tsx surfaces in the floating banner.
  async function manualAdd(
    text: string,
    type: 'post' | 'reply' | 'thread',
    bundleId: string | null,
  ): Promise<void> {
    setAdding(false);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:add-manual-result' }>
      >({ type: 'panel:add-manual-item', text, itemType: type, bundleId });
      if (!reply.ok) {
        onToast(reply.message);
        return;
      }
      await refresh();
      if (bundleId !== null) await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add.');
    }
  }

  return (
    <div className="screen flush">
      <CaptureBanner handle={handle} bundles={bundles} onCreateBundle={createEmptyBundle} />

      {adding && (
        <AddForm
          bundles={bundles}
          onCreateBundle={createEmptyBundle}
          onAdd={(text, type, bundleId) => void manualAdd(text, type, bundleId)}
          onCancel={() => setAdding(false)}
        />
      )}

      {items.length > 0 && (
        <div className="lib-search">
          <IcSearch className="ls-icon" />
          <input
            type="search"
            placeholder="Search your examples"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            aria-label="Search saved examples"
          />
        </div>
      )}

      <div className="filterrow">
        <button
          type="button"
          className={`pill ${filter === 'all' && !starredOnly ? 'active' : ''}`}
          onClick={(e) => clickType('all', e.metaKey || e.ctrlKey)}
        >
          All {starBase.length}
        </button>
        <button
          type="button"
          className={`pill ${filter === 'post' ? 'active' : ''}`}
          title="⌘-click to combine with ★"
          onClick={(e) => clickType('post', e.metaKey || e.ctrlKey)}
        >
          Posts {posts}
        </button>
        <button
          type="button"
          className={`pill ${filter === 'reply' ? 'active' : ''}`}
          title="⌘-click to combine with ★"
          onClick={(e) => clickType('reply', e.metaKey || e.ctrlKey)}
        >
          Replies {replies}
        </button>
        {threadsTotal > 0 && (
          <button
            type="button"
            className={`pill ${filter === 'thread' ? 'active' : ''}`}
            title="⌘-click to combine with ★"
            onClick={(e) => clickType('thread', e.metaKey || e.ctrlKey)}
          >
            Threads {threads}
          </button>
        )}
        {starredTotal > 0 && (
          <button
            type="button"
            className={`pill ${starredOnly ? 'active' : ''}`}
            title="Starred items are guaranteed in every prompt — ⌘-click to combine with a type"
            onClick={(e) => clickStar(e.metaKey || e.ctrlKey)}
          >
            ★ {starred}
          </button>
        )}
      </div>

      <BundleSection
        bundles={bundles}
        items={items}
        open={bundlesOpen}
        onToggleOpen={() => setBundlesOpen((v) => !v)}
        onStartPicking={!picking ? () => startPicking(null) : null}
        onAddMembers={!picking && items.length > 0 ? (b) => startPicking(b.id) : null}
        creation={
          picking
            ? {
                name: bundleName,
                setName: setBundleName,
                target: pickTarget,
                setTarget: retargetPicks,
                pickedCount: pickedIds.length,
                canSave: canSavePicks,
                onSave: () => void savePicks(),
                onCancel: stopPicking,
              }
            : null
        }
        onRename={(b, name) => void renameBundle(b, name)}
        onRemoveMember={(b, itemId) => void removeBundleMember(b, itemId)}
        onLocateMember={onLocateItem}
        onMoveMember={(b, itemId, dir) => void moveMember(b, itemId, dir)}
        onDelete={(b) => void removeBundle(b)}
      />

      <div className="sec-head examples-head">
        <button
          type="button"
          className="sec-toggle"
          aria-expanded={examplesOpen}
          onClick={() => setExamplesOpen((v) => !v)}
          title={examplesOpen ? 'Collapse saved examples' : 'Show saved examples'}
        >
          {examplesOpen ? <IcChevDown /> : <IcChevR />}
          <span className="eyebrow">
            Saved examples{items.length > 0 ? ` · ${items.length}` : ''}
          </span>
        </button>
        <span className="head-spacer" />
        {!adding && (
          <button
            type="button"
            className="icon-btn"
            title="Add manually"
            aria-label="Add manually"
            onClick={() => {
              setExamplesOpen(true);
              setAdding(true);
            }}
          >
            <IcPlus />
          </button>
        )}
        {examplesOpen && visible.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            title={allOpen ? 'Collapse all' : 'Expand all'}
            aria-label={allOpen ? 'Collapse all' : 'Expand all'}
            onClick={toggleAll}
          >
            {allOpen ? <IcChevDown /> : <IcChevR />}
          </button>
        )}
      </div>

      {!examplesOpen ? null : visible.length === 0 ? (
        items.length === 0 ? (
          <div className="empty">
            <IcVoice className="ei" />
            <span className="empty-lede">Nothing saved yet.</span>
            <span>
              Turn on saving above and click your own posts on x.com — or paste one in by hand.
            </span>
          </div>
        ) : query.trim() !== '' ? (
          <div className="empty">
            <IcSearch className="ei" />
            <span className="empty-lede">No matches for “{query.trim()}”</span>
            <span>
              {filter !== 'all' ? 'under this filter. ' : ''}
              <button type="button" className="lib-more" onClick={() => setQuery('')}>
                Clear search
              </button>
            </span>
          </div>
        ) : (
          <div className="empty">
            <IcVoice className="ei" />
            <span className="empty-lede">
              No {starredOnly ? 'starred ' : ''}
              {filter === 'post'
                ? 'posts'
                : filter === 'reply'
                  ? 'replies'
                  : filter === 'thread'
                    ? 'threads'
                    : 'examples'}{' '}
              saved yet
            </span>
            <span>
              Switch to <strong>All</strong> to see the rest.
            </span>
          </div>
        )
      ) : (
        <ul className="lib-list">
          {visible.map((it) => (
            <LibRow
              key={it.id}
              item={it}
              open={openIds.has(it.id)}
              highlight={flashRow?.id === it.id ? flashRow.kind : null}
              onToggle={() => toggleRow(it.id)}
              onRemove={() => void remove(it)}
              onSave={(patch) => void patchItem(it.id, patch)}
              selection={
                picking
                  ? {
                      index: pickedIds.includes(it.id) ? pickedIds.indexOf(it.id) + 1 : null,
                      // Appending to an existing bundle: its members
                      // show a locked check, not a pickable row.
                      locked:
                        pickTarget !== null &&
                        (bundles.find((b) => b.id === pickTarget)?.memberIds.includes(it.id) ??
                          false),
                      onToggle: () => togglePick(it.id),
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
