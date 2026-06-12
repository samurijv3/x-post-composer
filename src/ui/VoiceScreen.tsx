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
import type { Bundle, LibraryItem } from '../types';
import { IcChevDown, IcChevR, IcPlus, IcVoice } from './icons';
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

type Filter = 'all' | 'post' | 'reply' | 'starred';

/**
 * Voice — the saved-examples library. Owns the list state and storage
 * round-trips; the banner, rows, and add-form live in ./voice.
 */
export function VoiceScreen({ onToast, flashRow, onLocateItem }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [handle, setHandle] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<boolean>(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  // ---- bundles (roadmap Phase 6) ----
  const [bundles, setBundles] = useState<Bundle[]>([]);
  // Bundle-building selection mode: pickedIds is in SELECTION order —
  // that order is the bundle's stored member order.
  const [picking, setPicking] = useState<boolean>(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [bundleName, setBundleName] = useState<string>('');
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

  const posts = items.filter((i) => i.type === 'post').length;
  const replies = items.filter((i) => i.type === 'reply').length;
  // The visible count IS the control: it nudges toward a small canon
  // (Core Concept A) — deliberately no ranking or bulk tools.
  const starred = items.filter((i) => i.favorite).length;
  const visible =
    filter === 'all'
      ? items
      : filter === 'starred'
        ? items.filter((i) => i.favorite)
        : items.filter((i) => i.type === filter);

  // The starred pill disappears when the last star is removed — don't
  // leave the filter stuck on a state with no control to escape it.
  useEffect(() => {
    if (filter === 'starred' && starred === 0) setFilter('all');
  }, [filter, starred]);

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

  function startPicking(): void {
    setPicking(true);
    // Picking needs both sections: the create bar lives in Bundles,
    // the pick targets are the examples list.
    setBundlesOpen(true);
    setExamplesOpen(true);
  }

  function stopPicking(): void {
    setPicking(false);
    setPickedIds([]);
    setBundleName('');
  }

  async function saveBundle(): Promise<void> {
    const name = bundleName.trim();
    if (name === '' || pickedIds.length === 0) return;
    try {
      await addBundle({
        id: crypto.randomUUID(),
        name,
        memberIds: pickedIds,
        createdAt: Date.now(),
      });
      stopPicking();
      onToast(`Bundle “${name}” saved`);
      await refreshBundles();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save the bundle.');
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
    type: 'post' | 'reply',
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
    <div className="screen">
      <div>
        <h2 className="section-title">Voice</h2>
        <p className="help" style={{ marginTop: 2 }}>
          Examples of your own writing. Drafts borrow this voice — the more here, the closer the
          match.
        </p>
      </div>

      <CaptureBanner handle={handle} bundles={bundles} />

      <BundleSection
        bundles={bundles}
        items={items}
        open={bundlesOpen}
        onToggleOpen={() => setBundlesOpen((v) => !v)}
        onStartPicking={!picking && items.length > 0 ? startPicking : null}
        creation={
          picking
            ? {
                name: bundleName,
                setName: setBundleName,
                pickedCount: pickedIds.length,
                onSave: () => void saveBundle(),
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

      <div className="sec-head">
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
        {/* Only show + when the form is closed. While open, the
            dismiss control lives inside the form's own header so it's
            visually attached to the thing being dismissed. */}
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
      </div>

      {examplesOpen && (
        <>
          <p className="help" style={{ margin: '-6px 0 0' }}>
            The writing your drafts learn from. Edit or retype anytime.
          </p>

          {adding && (
            <AddForm
              bundles={bundles}
              onAdd={(text, type, bundleId) => void manualAdd(text, type, bundleId)}
              onCancel={() => setAdding(false)}
            />
          )}

          <div className="field-row">
            <div className="pillrow">
              <button
                type="button"
                className={`pill ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All {items.length}
              </button>
              <button
                type="button"
                className={`pill ${filter === 'post' ? 'active' : ''}`}
                onClick={() => setFilter('post')}
              >
                Posts {posts}
              </button>
              <button
                type="button"
                className={`pill ${filter === 'reply' ? 'active' : ''}`}
                onClick={() => setFilter('reply')}
              >
                Replies {replies}
              </button>
              {starred > 0 && (
                <button
                  type="button"
                  className={`pill ${filter === 'starred' ? 'active' : ''}`}
                  title="Starred items are guaranteed in every prompt — keep the set small"
                  onClick={() => setFilter('starred')}
                >
                  ★ {starred}
                </button>
              )}
            </div>
            {visible.length > 0 && (
              <button type="button" className="btn ghost sm" onClick={toggleAll}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
        </>
      )}

      {!examplesOpen ? null : visible.length === 0 ? (
        items.length === 0 ? (
          <div className="empty">
            <IcVoice className="ei" />
            Nothing saved yet. Turn on saving above and click your own posts on x.com — or paste one
            in by hand.
          </div>
        ) : (
          <div className="empty">
            <IcVoice className="ei" />
            No {filter === 'post'
              ? 'posts'
              : filter === 'reply'
                ? 'replies'
                : 'starred examples'}{' '}
            saved yet — switch to <strong>All</strong> to see the rest.
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
