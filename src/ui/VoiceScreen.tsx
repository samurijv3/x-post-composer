import { useCallback, useEffect, useState } from 'react';
import { addItem, deleteItem, getAllItems, getSettings, updateItem } from '../storage';
import { isMessageOfType, onNotice, sendToBackground, type BackgroundReply } from '../messaging';
import type { LibraryItem } from '../types';
import { IcPlus, IcVoice } from './icons';
import type { ToastData } from './Toast';
import { AddForm } from './voice/AddForm';
import { CaptureBanner } from './voice/CaptureBanner';
import { LibRow } from './voice/LibRow';

/** Row App wants flashed: 'added' after a successful save, 'dup' when
 *  the user clicks "Show me" on the duplicate banner (scrolls too). */
export interface FlashRow {
  id: string;
  kind: 'added' | 'dup';
}

interface Props {
  onToast: (msg: string, action?: ToastData['action']) => void;
  flashRow: FlashRow | null;
}

type Filter = 'all' | 'post' | 'reply' | 'starred';

/**
 * Voice — the saved-examples library. Owns the list state and storage
 * round-trips; the banner, rows, and add-form live in ./voice.
 */
export function VoiceScreen({ onToast, flashRow }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [handle, setHandle] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<boolean>(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  // "Show me" promised to show THE row — if a type filter would hide
  // it, the flash would be invisible and the CTA would read as broken.
  // Widen to All before the row renders. (Just-added flashes don't
  // override the user's filter; they didn't ask to jump anywhere.)
  useEffect(() => {
    if (flashRow?.kind === 'dup') setFilter('all');
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

  useEffect(() => {
    void refresh();
    void getSettings().then((s) => setHandle(s.handle));
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:library-changed')) void refresh();
    });
    return () => unsub();
  }, [refresh]);

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

  // Manual add — dedupe locally then send to background which saves.
  // Background broadcasts the save-result notice on success/dup, which
  // App.tsx surfaces in the floating banner.
  async function manualAdd(text: string, type: 'post' | 'reply'): Promise<void> {
    setAdding(false);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:add-manual-result' }>
      >({ type: 'panel:add-manual-item', text, itemType: type });
      if (!reply.ok) {
        onToast(reply.message);
        return;
      }
      await refresh();
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

      <CaptureBanner handle={handle} />

      <div className="lib-header">
        <div>
          <span className="eyebrow">Saved examples</span>
          <p className="help" style={{ marginTop: 2 }}>
            The writing your drafts learn from. Edit or retype anytime.
          </p>
        </div>
        {/* Only show + when the form is closed. While open, the
            dismiss control lives inside the form's own header so it's
            visually attached to the thing being dismissed. */}
        {!adding && (
          <button
            type="button"
            className="icon-btn"
            title="Add manually"
            aria-label="Add manually"
            onClick={() => setAdding(true)}
          >
            <IcPlus />
          </button>
        )}
      </div>

      {adding && (
        <AddForm
          onAdd={(text, type) => void manualAdd(text, type)}
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

      {visible.length === 0 ? (
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}
