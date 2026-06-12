import { useLayoutEffect, useRef, useState } from 'react';
import type { LibraryItem } from '../../types';
import { Avatar } from '../Avatar';
import { IcEdit, IcStar, IcTrash } from '../icons';
import { formatRelativeTweetTime } from '../../lib/format/relativeTime';

interface LibRowProps {
  item: LibraryItem;
  open: boolean;
  highlight: 'added' | 'dup' | null;
  onToggle: () => void;
  onRemove: () => void;
  onSave: (patch: Partial<LibraryItem>) => void;
  /** Bundle-building selection mode: when non-null, the row renders a
   *  pick control instead of its actions, and the value is this row's
   *  1-based position in the selection (members are stored in selection
   *  order — the number makes that order visible) or null if unpicked. */
  selection?: { index: number | null; onToggle: () => void };
}

/** One saved example — clamped to 2 lines with Show more/less, inline edit. */
export function LibRow({
  item,
  open,
  highlight,
  onToggle,
  onRemove,
  onSave,
  selection,
}: LibRowProps) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [truncatable, setTruncatable] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [text, setText] = useState<string>(item.text);
  const [type, setType] = useState<'post' | 'reply'>(item.type);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && !editing) setTruncatable(el.scrollHeight > el.clientHeight + 2);
  }, [editing, item.text]);

  // "Show me" (the duplicate banner's CTA) explicitly asked to see THIS
  // row — bring it into view before flashing, or an off-screen flash
  // reads as "the button did nothing." Just-added flashes deliberately
  // don't scroll: the user may be mid-scroll and didn't ask to jump.
  useLayoutEffect(() => {
    if (highlight === 'dup') {
      rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlight]);

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
  const picked = selection?.index != null;

  return (
    <li
      ref={rowRef}
      className={`lib-row ${hl} ${editing ? 'editing' : ''} ${selection ? 'pickable' : ''} ${picked ? 'picked' : ''}`}
      // In selection mode the whole row is the pick target (the
      // checkbox inside carries keyboard access).
      onClick={selection ? selection.onToggle : undefined}
    >
      {editing ? (
        <div className="lib-edit">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
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
              {item.authorDisplayName && <span className="tn-name">{item.authorDisplayName}</span>}
              <span className="tn-handle">@{item.authorHandle}</span>
              {relTime && (
                <>
                  <span className="tn-dot">·</span>
                  <span className="tn-time">{relTime}</span>
                </>
              )}
              <span className={`tn-type-chip ${item.type}`}>{item.type}</span>
              {item.source === 'shipped' && (
                <span
                  className="badge ok"
                  title="Composed in Margin and copied to X — handpicking the published tweet promotes it to a manual example"
                >
                  shipped
                </span>
              )}
              <span className="head-spacer" />
              {selection ? (
                <label className="pick-mark" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={selection.onToggle}
                    aria-label={picked ? 'Remove from bundle' : 'Add to bundle'}
                  />
                  <span className="pick-badge">{selection.index ?? ''}</span>
                </label>
              ) : (
                <div className="lib-actions">
                  {item.source !== 'archive' && (
                    // The starring boundary (Core Concept A): manual and
                    // shipped only. Archive items are promoted by finding
                    // them on X and handpicking — never starred directly.
                    <button
                      type="button"
                      className={`icon-btn star-btn ${item.favorite ? 'starred' : ''}`}
                      style={{ width: 26, height: 26 }}
                      title={
                        item.favorite
                          ? 'Starred — guaranteed in every prompt as an aspirational example. Click to unstar.'
                          : 'Star — you at your best; the bar drafts should reach for'
                      }
                      aria-label={item.favorite ? 'Unstar' : 'Star'}
                      aria-pressed={item.favorite}
                      onClick={() => onSave({ favorite: !item.favorite })}
                    >
                      <IcStar />
                    </button>
                  )}
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
              )}
            </div>
            <p ref={textRef} className={`tn-text lib-text ${open ? '' : 'clamp'}`}>
              {item.text}
            </p>
            {(truncatable || open) && (
              <button
                type="button"
                className="lib-more"
                // stopPropagation: in selection mode the row itself is a
                // pick target — expanding must not toggle the pick.
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
              >
                {open ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
