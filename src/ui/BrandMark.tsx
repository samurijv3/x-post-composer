/**
 * The Margin brand mark — a rounded square (accent fill) with a
 * vertical "ruled margin" line and two horizontal text lines.
 * Plain HTML elements + CSS, no SVG, so it scales cleanly via the
 * `.brand-mark` rule in styles.css.
 */
export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="bm-rule" />
      <span className="bm-lines" />
    </div>
  );
}
