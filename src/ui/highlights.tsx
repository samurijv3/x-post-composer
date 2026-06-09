import type { ReactNode } from 'react';
import type { Span } from '../lib/exclusion';

/**
 * Render a text body as a sequence of plain text + `<mark>` highlights,
 * one for each violation span. Overlapping spans are merged by keeping
 * the first and skipping any that start before the running cursor.
 *
 * The CSS class on each mark is `hl hl-<rule>` so the Output rules
 * legend can colour each kind distinctly.
 */
export function renderWithHighlights(text: string, spans: Span[]): ReactNode {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  let keyN = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      parts.push(<span key={`t${String(keyN++)}`}>{text.slice(cursor, span.start)}</span>);
    }
    parts.push(
      <mark
        key={`m${String(keyN++)}`}
        className={`hl hl-${span.rule}`}
        title={`${span.rule}${span.entry ? `: ${span.entry}` : ''}`}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t${String(keyN)}`}>{text.slice(cursor)}</span>);
  }
  return parts;
}
