import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  addItem,
  deleteItem,
  getAllItems,
  getCaptureMode,
  getSettings,
  setCaptureMode,
  subscribeCaptureMode,
  updateItem,
} from '../storage';
import {
  isMessageOfType,
  onNotice,
  sendToBackground,
  type BackgroundReply,
} from '../messaging';
import type { LibraryItem } from '../types';
import { IcEdit, IcPlus, IcTrash, IcVoice, IcX } from './icons';
import type { ToastData } from './Toast';
import { Avatar } from './Avatar';
import { formatRelativeTweetTime } from '../lib/format/relativeTime';

interface Props {
  onToast: (msg: string, action?: ToastData['action']) => void;
  /** Row to flash. Set by App when a save succeeds (just-added) or
   *  the user clicks "Show me" on a duplicate banner. */
  flashRowId: string | null;
}

type Filter = 'all' | 'post' | 'reply';

export function VoiceScreen({ onToast, flashRowId }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [handle, setHandle] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<boolean>(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

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

  // Save-result banners are owned by the panel shell now (App.tsx) so
  // they float at the top of the viewport across screens. VoiceScreen
  // only consumes `flashRowId` (from props) to animate the matching
  // library row.
  void handle; // kept in scope for now; future banners may surface it

  const posts = items.filter((i) => i.type === 'post').length;
  const replies = items.filter((i) => i.type === 'reply').length;
  const visible = filter === 'all' ? items : items.filter((i) => i.type === filter);

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
            No {filter === 'post' ? 'posts' : 'replies'} saved yet — switch to <strong>All</strong>{' '}
            to see the rest.
          </div>
        )
      ) : (
        <ul className="lib-list">
          {visible.map((it) => (
            <LibRow
              key={it.id}
              item={it}
              open={openIds.has(it.id)}
              highlight={flashRowId === it.id ? 'added' : null}
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

// ---------------------------------------------------------------------
// Capture banner — the "Saving from X" toggle
// ---------------------------------------------------------------------

function CaptureBanner({ handle }: { handle: string }) {
  const [mode, setMode] = useState<'none' | 'library' | 'reply-context'>('none');
  useEffect(() => {
    void getCaptureMode().then(setMode);
    const unsub = subscribeCaptureMode(setMode);
    return () => unsub();
  }, []);
  const on = mode === 'library';

  async function toggle(): Promise<void> {
    await setCaptureMode(on ? 'none' : 'library');
  }

  return (
    <div className={`capture-banner ${on ? 'on' : ''}`}>
      <div className="cb-top">
        <span className="cb-dot" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{on ? 'Saving from X' : 'Save tweets from X'}</div>
          <p className="help" style={{ marginTop: 1 }}>
            {on
              ? 'Click your posts on x.com and they’ll land here.'
              : handle
                ? `Click your own posts on x.com to save them. Only @${handle}’s writing gets in.`
                : 'Set your handle in Settings → Account first.'}
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={() => void toggle()} />
          <span className="track track-ok" />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Lib row — clamped to 2 lines with Show more/less, hover actions
// ---------------------------------------------------------------------

interface LibRowProps {
  item: LibraryItem;
  open: boolean;
  highlight: 'added' | 'dup' | null;
  onToggle: () => void;
  onRemove: () => void;
  onSave: (patch: Partial<LibraryItem>) => void;
}

function LibRow({ item, open, highlight, onToggle, onRemove, onSave }: LibRowProps) {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [truncatable, setTruncatable] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [text, setText] = useState<string>(item.text);
  const [type, setType] = useState<'post' | 'reply'>(item.type);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && !editing) setTruncatable(el.scrollHeight > el.clientHeight + 2);
  }, [editing, item.text]);

  function save(): void {
    if (text.trim() === '') return;
    onSave({ text: text.trim(), type });
    setEditing(false);
  }
  function cancel(): void {
    setText(item.text);
    setType(item.type);
    setEditing(false);
  }

  const hl = highlight === 'added' ? 'just-added' : highlight === 'dup' ? 'flash-dup' : '';
  const relTime = formatRelativeTweetTime(item.timestamp);
  const displayName = item.authorDisplayName ?? item.authorHandle;

  return (
    <li className={`lib-row ${hl} ${editing ? 'editing' : ''}`}>
      {editing ? (
        <div className="lib-edit">
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="field-row">
            <div className="seg" style={{ flex: '0 0 auto' }}>
              <button
                type="button"
                className={type === 'post' ? 'active' : ''}
                onClick={() => setType('post')}
                style={{ padding: '5px 14px' }}
              >
                Post
              </button>
              <button
                type="button"
                className={type === 'reply' ? 'active' : ''}
                onClick={() => setType('reply')}
                style={{ padding: '5px 14px' }}
              >
                Reply
              </button>
            </div>
            <span className="head-spacer" />
            <button type="button" className="btn ghost sm" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary sm"
              disabled={text.trim() === ''}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="tweet-native">
          <Avatar src={item.authorAvatarUrl} name={displayName} size={36} />
          <div className="tweet-native-body">
            <div className="tweet-native-head">
              {item.authorDisplayName && (
                <span className="tn-name">{item.authorDisplayName}</span>
              )}
              <span className="tn-handle">@{item.authorHandle}</span>
              {relTime && (
                <>
                  <span className="tn-dot">·</span>
                  <span className="tn-time">{relTime}</span>
                </>
              )}
              <span className={`tn-type-chip ${item.type}`}>{item.type}</span>
              <span className="head-spacer" />
              <div className="lib-actions">
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  title="Edit"
                  aria-label="Edit"
                  onClick={() => setEditing(true)}
                >
                  <IcEdit />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  title="Delete"
                  aria-label="Delete"
                  onClick={onRemove}
                >
                  <IcTrash />
                </button>
              </div>
            </div>
            <p ref={textRef} className={`tn-text lib-text ${open ? '' : 'clamp'}`}>
              {item.text}
            </p>
            {(truncatable || open) && (
              <button type="button" className="lib-more" onClick={onToggle}>
                {open ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------

interface AddFormProps {
  onAdd: (text: string, type: 'post' | 'reply') => void;
  onCancel: () => void;
}

function AddForm({ onAdd, onCancel }: AddFormProps) {
  const [text, setText] = useState<string>('');
  const [type, setType] = useState<'post' | 'reply'>('post');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const ready = text.trim() !== '' && confirmed;
  return (
    <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="fld">
        <div className="field-row">
          <span className="fld-label">Paste your own post or reply</span>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            title="Discard"
            aria-label="Discard"
            onClick={onCancel}
          >
            <IcX />
          </button>
        </div>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="exactly as you wrote it"
        />
      </label>
      <div className="field-row">
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button
            type="button"
            className={type === 'post' ? 'active' : ''}
            onClick={() => setType('post')}
            style={{ padding: '5px 14px' }}
          >
            Post
          </button>
          <button
            type="button"
            className={type === 'reply' ? 'active' : ''}
            onClick={() => setType('reply')}
            style={{ padding: '5px 14px' }}
          >
            Reply
          </button>
        </div>
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="track" />
        <span className="help" style={{ color: 'var(--text-2)' }}>
          This is my own writing
        </span>
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!ready}
        onClick={() => onAdd(text.trim(), type)}
      >
        Save to voice
      </button>
    </div>
  );
}
