/**
 * Overlay system — the only place the extension ADDS elements to an
 * x.com page.
 *
 * Two overlay states:
 *   - preview: outline-only highlight that follows the hovered tweet
 *     while a capture mode is active. No fill, no controls.
 *   - lock:    outline + tinted fill on the captured reply-context
 *     tweet, with a dismiss control and a label below. Persists across
 *     scrolls; cleared on dismiss, mode-off, or SPA navigation.
 *
 * Per the §6 carve-out (see CLAUDE.md):
 *   - All overlay elements carry `data-margin-overlay` for easy audit.
 *   - All visuals are `pointer-events: none`. The dismiss control is
 *     the ONLY interactive child; it only clears extension-side state.
 *   - We never annotate X's own elements.
 */

export interface OverlaySystem {
  setPreview(article: Element | null): void;
  setLock(article: Element | null): void;
  getLockTarget(): Element | null;
  reposition(): void;
  destroy(): void;
}

export function createOverlaySystem(opts: { onDismiss: () => void }): OverlaySystem {
  injectOverlayStyles();

  const root = document.createElement('div');
  root.setAttribute('data-margin-overlay', 'root');
  root.style.position = 'fixed';
  root.style.top = '0';
  root.style.left = '0';
  root.style.width = '0';
  root.style.height = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483000';
  document.body.appendChild(root);

  const previewEl = buildOverlayElement('preview');
  const lockEl = buildOverlayElement('lock');
  const dismissBtn = document.createElement('button');
  dismissBtn.setAttribute('data-margin-overlay', 'dismiss');
  dismissBtn.setAttribute('type', 'button');
  dismissBtn.setAttribute('aria-label', 'Clear reply context');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onDismiss();
  });
  lockEl.appendChild(dismissBtn);

  const labelEl = document.createElement('div');
  labelEl.setAttribute('data-margin-overlay', 'label');
  labelEl.textContent = '↑ pulled in as reply context';

  root.appendChild(previewEl);
  root.appendChild(lockEl);
  root.appendChild(labelEl);

  let previewTarget: Element | null = null;
  let lockTarget: Element | null = null;
  // Cache the last-applied rect per overlay element. The rAF loop calls
  // `reposition` every frame; without this cache, every frame writes
  // identical `style.top/left` values which interrupts the CSS
  // transition (each style write is treated as a new target). With the
  // cache, the transition only kicks off when the rect actually moves.
  const cachedRects = new WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>();

  function setPreview(article: Element | null): void {
    const changed = article !== previewTarget;
    previewTarget = article;
    if (!article) {
      previewEl.style.display = 'none';
      return;
    }
    previewEl.style.display = 'block';
    if (changed) animateOnce(previewEl);
    positionElement(previewEl, article.getBoundingClientRect(), cachedRects);
  }

  function setLock(article: Element | null): void {
    const changed = article !== lockTarget;
    lockTarget = article;
    const visible = article !== null;
    lockEl.style.display = visible ? 'block' : 'none';
    labelEl.style.display = visible ? 'block' : 'none';
    if (article) {
      if (changed) {
        animateOnce(lockEl);
        animateOnce(labelEl);
      }
      const rect = article.getBoundingClientRect();
      positionElement(lockEl, rect, cachedRects);
      positionLabel(labelEl, rect, cachedRects);
    }
  }

  /**
   * Add the `.moving` class briefly so CSS transitions apply during a
   * target change, then remove it so subsequent per-frame scroll
   * updates skip the transition (and thus stay perfectly in sync with
   * the cursor's scroll position rather than lagging by the animation
   * duration). 220 ms covers the 160 ms transition with a buffer.
   */
  function animateOnce(el: HTMLElement): void {
    el.classList.add('moving');
    // Long enough to cover the 0.16s lock transition. Preview's 0.08s
    // also fits comfortably under this ceiling.
    window.setTimeout(() => el.classList.remove('moving'), 220);
  }

  function reposition(): void {
    if (previewTarget && previewEl.style.display !== 'none') {
      positionElement(previewEl, previewTarget.getBoundingClientRect(), cachedRects);
    }
    if (lockTarget && lockEl.style.display !== 'none') {
      const rect = lockTarget.getBoundingClientRect();
      positionElement(lockEl, rect, cachedRects);
      positionLabel(labelEl, rect, cachedRects);
    }
  }

  function destroy(): void {
    root.remove();
  }

  return {
    setPreview,
    setLock,
    getLockTarget: () => lockTarget,
    reposition,
    destroy,
  };
}

function buildOverlayElement(kind: 'preview' | 'lock'): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('data-margin-overlay', kind);
  el.style.position = 'fixed';
  el.style.boxSizing = 'border-box';
  el.style.pointerEvents = 'none';
  el.style.display = 'none';
  return el;
}

function positionElement(
  el: HTMLElement,
  rect: DOMRect,
  cache: WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>,
): void {
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const last = cache.get(el);
  if (last && last.x === x && last.y === y && last.w === w && last.h === h) return;
  el.style.top = `${String(y)}px`;
  el.style.left = `${String(x)}px`;
  el.style.width = `${String(w)}px`;
  el.style.height = `${String(h)}px`;
  cache.set(el, { x, y, w, h });
}

function positionLabel(
  el: HTMLElement,
  rect: DOMRect,
  cache: WeakMap<HTMLElement, { x: number; y: number; w: number; h: number }>,
): void {
  // Label anchors to the bottom-left of the lock highlight, just below
  // the rectangle. Vertical offset of 4px keeps it visually attached
  // to the bottom border without overlapping it. Width/height aren't
  // applied because the label sizes to its content (the pill style).
  const x = Math.round(rect.left + 8);
  const y = Math.round(rect.bottom + 4);
  const last = cache.get(el);
  if (last && last.x === x && last.y === y) return;
  el.style.top = `${String(y)}px`;
  el.style.left = `${String(x)}px`;
  cache.set(el, { x, y, w: 0, h: 0 });
}

let stylesInjected = false;
function injectOverlayStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-margin-overlay', 'styles');
  // Define the overlay's own colour scope rather than reading the
  // panel's `[data-theme]` token (X.com is its own document and we
  // can't reach the panel's CSS variables from here). Two colour
  // schemes: an oklch muted-blue that matches the panel's accent in
  // light theme, and a slightly brighter variant for users browsing
  // X in dark mode. We auto-detect via `prefers-color-scheme`.
  style.textContent = `
    [data-margin-overlay="root"] {
      --margin-accent: oklch(0.56 0.12 250);
      --margin-accent-fill: oklch(0.56 0.12 250 / 0.08);
      --margin-accent-hover: oklch(0.5 0.13 250);
      --margin-on-accent: oklch(0.99 0.005 250);
    }
    @media (prefers-color-scheme: dark) {
      [data-margin-overlay="root"] {
        --margin-accent: oklch(0.7 0.13 248);
        --margin-accent-fill: oklch(0.7 0.13 248 / 0.10);
        --margin-accent-hover: oklch(0.76 0.13 248);
        --margin-on-accent: oklch(0.15 0.02 250);
      }
    }
    [data-margin-overlay="preview"] {
      border: 2px solid color-mix(in oklab, var(--margin-accent) 70%, transparent);
      border-radius: 16px;
      background: transparent;
    }
    [data-margin-overlay="lock"] {
      border: 2px solid var(--margin-accent);
      border-radius: 16px;
      background: var(--margin-accent-fill);
    }
    [data-margin-overlay="preview"].moving {
      transition: top 0.08s ease-out, left 0.08s ease-out,
                  width 0.08s ease-out, height 0.08s ease-out;
    }
    [data-margin-overlay="lock"].moving {
      transition: top 0.16s ease-out, left 0.16s ease-out,
                  width 0.16s ease-out, height 0.16s ease-out;
    }
    [data-margin-overlay="dismiss"] {
      position: absolute;
      top: -10px;
      right: -10px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 0;
      background: var(--margin-accent);
      color: var(--margin-on-accent);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 0;
    }
    [data-margin-overlay="dismiss"]:hover {
      background: var(--margin-accent-hover);
    }
    [data-margin-overlay="label"] {
      position: fixed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: var(--margin-on-accent);
      background: var(--margin-accent);
      padding: 4px 10px;
      border-radius: 6px;
      pointer-events: none;
      display: none;
      box-shadow: 0 1px 3px oklch(0 0 0 / 0.18);
      white-space: nowrap;
      z-index: 2147483000;
    }
    [data-margin-overlay="label"].moving {
      transition: top 0.16s ease-out, left 0.16s ease-out;
    }
  `;
  document.head.appendChild(style);
}
