import { useState } from 'react';
import type { LibraryItem } from '../../types';
import { joinSegments } from '../../lib/thread';

/** A thread item's segments, read from the record with a defensive
 *  fallback (a segments-less thread renders its joined text whole). */
function segmentTexts(item: LibraryItem): string[] {
  return item.segments?.map((s) => s.text) ?? [item.text];
}

/**
 * The thread row's text body: collapsed = the first post clamped (a
 * thread row must not dominate the list), expanded = every post as
 * connected blocks, X-style. The toggle is always offered — a thread
 * always has more below the fold.
 */
export function ThreadText({
  item,
  open,
  onToggle,
}: {
  item: LibraryItem;
  open: boolean;
  onToggle: () => void;
}) {
  const segments = segmentTexts(item);
  return (
    <>
      {open ? (
        <ol className="thread-segs">
          {segments.map((text, i) => (
            <li key={i} className="ts-seg">
              <span className="ts-ordinal">{i + 1}/</span>
              <p className="tn-text lib-text">{text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="tn-text lib-text clamp">{segments[0]}</p>
      )}
      <button
        type="button"
        className="lib-more"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {open ? 'Show less' : `Show thread (${segments.length} posts)`}
      </button>
    </>
  );
}

/**
 * Inline editor for a thread row: one textarea per post. Text edits
 * only in v1 — no add/remove/reorder, no type conversion (structural
 * ops are deferrable; editability of every saved word is the ethos).
 * Saving rejoins `text` and keeps each segment's status id.
 */
export function ThreadEditor({
  item,
  onSave,
  onCancel,
}: {
  item: LibraryItem;
  onSave: (patch: Partial<LibraryItem>) => void;
  onCancel: () => void;
}) {
  const [texts, setTexts] = useState<string[]>(() => segmentTexts(item));
  const ready = texts.every((t) => t.trim() !== '');

  function save(): void {
    if (!ready) return;
    const trimmed = texts.map((t) => t.trim());
    onSave({
      text: joinSegments(trimmed),
      segments: trimmed.map((text, i) => ({
        text,
        statusId: item.segments?.[i]?.statusId ?? null,
      })),
    });
  }

  return (
    <div className="lib-edit">
      {texts.map((text, i) => (
        <label key={i} className="fld">
          <span className="fld-label">
            {i + 1}/{texts.length}
          </span>
          <textarea
            rows={3}
            value={text}
            autoFocus={i === 0}
            onChange={(e) => setTexts((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
          />
        </label>
      ))}
      <div className="field-row">
        <span className="head-spacer" />
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary sm" disabled={!ready} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
