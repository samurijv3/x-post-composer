import { useState } from 'react';
import type { LibraryItem } from '../types';
import { deleteItem, updateItem } from '../storage';
import { isBelowMinChars, isEmojiOnly, isSingleWord } from '../lib/screening';

interface Props {
  item: LibraryItem;
  /** Called after any persistent change so the parent re-fetches. */
  onChanged: () => void;
}

const MIN_USEFUL_CHARS = 20;

/**
 * One row of the library list. Inline edit replaces the read-only view
 * with a textarea + type radios; saving or cancelling returns to view.
 * Screening predicates power a soft "low-quality?" hint — never a block.
 */
export function LibraryItemRow({ item, onChanged }: Props) {
  const [editing, setEditing] = useState<boolean>(false);
  const [text, setText] = useState<string>(item.text);
  const [itemType, setItemType] = useState<'post' | 'reply'>(item.type);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const hint = lowQualityHint(item.text);

  function cancel(): void {
    setText(item.text);
    setItemType(item.type);
    setEditing(false);
    setError(null);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await updateItem({ ...item, text: text.trim(), type: itemType });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    const confirmed = window.confirm('Delete this item?');
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await deleteItem(item.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="lib-row">
      <div className="lib-meta">
        <span className={`badge badge-${item.type}`}>{item.type}</span>
        <span className="badge badge-source">{item.source}</span>
        {hint && <span className="badge badge-warn" title={hint}>low-quality?</span>}
      </div>

      {editing ? (
        <>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <div className="row">
            <label>
              Type{' '}
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as 'post' | 'reply')}
              >
                <option value="post">Post</option>
                <option value="reply">Reply</option>
              </select>
            </label>
            <button className="primary" type="button" onClick={save} disabled={busy}>
              Save
            </button>
            <button type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="lib-text">{item.text}</p>
          <div className="row">
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </button>
            <button type="button" onClick={remove} disabled={busy}>
              Delete
            </button>
          </div>
        </>
      )}

      {error && <div className="status err">{error}</div>}
    </li>
  );
}

function lowQualityHint(text: string): string | null {
  if (isEmojiOnly(text)) return 'Emoji-only content';
  if (isSingleWord(text)) return 'Single-word content';
  if (isBelowMinChars(text, MIN_USEFUL_CHARS)) return `Under ${String(MIN_USEFUL_CHARS)} characters`;
  return null;
}
