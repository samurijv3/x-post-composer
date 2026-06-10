import { useLayoutEffect, useRef, useState } from 'react';
import type { LibraryItem } from '../../types';
import { Avatar } from '../Avatar';
import { IcEdit, IcTrash } from '../icons';
import { formatRelativeTweetTime } from '../../lib/format/relativeTime';

interface LibRowProps {
  item: LibraryItem;
  open: boolean;
  highlight: 'added' | 'dup' | null;
  onToggle: () => void;
  onRemove: () => void;
  onSave: (patch: Partial<LibraryItem>) => void;
}

/** One saved example — clamped to 2 lines with Show more/less, inline edit. */
export function LibRow({ item, open, highlight, onToggle, onRemove, onSave }: LibRowProps) {
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
