import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Span } from '../../lib/exclusion';
import { renderWithHighlights } from '../highlights';

interface DraftEditorProps {
  text: string;
  /** Residual violations to mark. Already `[]` once the user has
   *  hand-edited (lifecycle clears them — hand edits bypass exclusions). */
  violations: Span[];
  disabled: boolean;
  onEdit: (text: string) => void;
}

/**
 * The directly-editable draft surface — type, delete, reformat, paste
 * in place. A plain textarea carries the real text (native caret,
 * selection, paste); while residual violations exist, an aria-hidden
 * backdrop with identical text metrics renders the highlight marks
 * behind the glyphs. The backdrop vanishes on the first hand edit
 * (the lifecycle clears the spans), so any metric drift between the
 * two layers can only ever show before the user starts typing.
 */
export function DraftEditor({ text, violations, disabled, onEdit }: DraftEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow to fit content — with no internal scrolling, the two
  // layers can never scroll out of sync.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [text]);

  // Re-fit when the WIDTH changes (the side panel is user-resizable):
  // narrower wraps the same text onto more lines, and a height
  // measured at the old width would clip them with no scrollbar.
  // Width-gated so our own height writes can't loop the observer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      el.style.height = 'auto';
      el.style.height = `${String(el.scrollHeight)}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="draft-editor">
      {violations.length > 0 && (
        <div className="draft-editor-layer draft-editor-backdrop" aria-hidden="true">
          {renderWithHighlights(text, violations)}
          {/* keep the backdrop's final line when the text ends in a newline */}
          {text.endsWith('\n') ? '​' : null}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="draft-editor-layer draft-editor-input"
        value={text}
        rows={1}
        disabled={disabled}
        spellCheck
        aria-label="Your draft — edit freely; your edits are kept as-is"
        onChange={(e) => onEdit(e.target.value)}
      />
    </div>
  );
}
