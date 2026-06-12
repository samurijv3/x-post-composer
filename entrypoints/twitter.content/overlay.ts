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
  /** Re-sample the PAGE's background for light/dark — X's theme is
   *  per-site, not per-OS. Called on the shared state-scan throttle
   *  so SPA navigations (and theme switches) are picked up. */
  refreshScheme(): void;
  destroy(): void;
}

export function createOverlaySystem(opts: { onDismiss: () => void }): OverlaySystem {
  injectOverlayStyles();

  const root = document.createElement('div');
  root.setAttribute('data-margin-overlay', 'root');
  root.setAttribute('data-margin-scheme', detectPageScheme());
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
  const labelGlyph = document.createElement('span');
  labelGlyph.setAttribute('data-margin-overlay', 'label-glyph');
  labelEl.appendChild(labelGlyph);
  labelEl.appendChild(document.createTextNode('Replying in Margin'));

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
    labelEl.style.display = visible ? 'flex' : 'none';
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

  function refreshScheme(): void {
    const scheme = detectPageScheme();
    if (root.getAttribute('data-margin-scheme') !== scheme) {
      root.setAttribute('data-margin-scheme', scheme);
    }
  }

  return {
    setPreview,
    setLock,
    getLockTarget: () => lockTarget,
    reposition,
    refreshScheme,
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
  // The pill half-overlaps the lock's bottom border (X's own badge
  // placement), 13px in from the left edge. Width/height aren't
  // applied because the label sizes to its content (the pill style).
  const x = Math.round(rect.left + 13);
  const y = Math.round(rect.bottom - 11);
  const last = cache.get(el);
  if (last && last.x === x && last.y === y) return;
  el.style.top = `${String(y)}px`;
  el.style.left = `${String(x)}px`;
  cache.set(el, { x, y, w: 0, h: 0 });
}

/** Light/dark from the PAGE's actual background luminance — X's theme
 *  is per-site, so prefers-color-scheme mismatches when OS and X
 *  themes differ. Unparseable backgrounds read as light (fails open
 *  to the lighter fill). */
function detectPageScheme(): 'light' | 'dark' {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    if (!m) return 'light';
    const luminance = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
    return luminance < 128 ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let stylesInjected = false;
function injectOverlayStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-margin-overlay', 'styles');
  // One accent — X's #1D9BF0, identical in light and dark (the reskin
  // rule). The page's light/dark only tunes the fill alpha and shadow;
  // it is detected from the PAGE's actual background (X's theme is
  // per-site — prefers-color-scheme mismatches when OS and X differ)
  // and re-sampled on the shared scan throttle via refreshScheme().
  style.textContent = `
    [data-margin-overlay="root"] {
      --margin-accent: #1d9bf0;
      --margin-accent-fill: rgba(29, 155, 240, 0.08);
      --margin-preview-line: rgba(29, 155, 240, 0.75);
    }
    [data-margin-overlay="root"][data-margin-scheme="dark"] {
      --margin-accent-fill: rgba(29, 155, 240, 0.12);
    }
    [data-margin-overlay="preview"] {
      border: 2px solid var(--margin-preview-line);
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
      top: 9px;
      right: 11px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 0;
      background: rgba(15, 20, 25, 0.75);
      -webkit-backdrop-filter: blur(4px);
      backdrop-filter: blur(4px);
      color: #fff;
      font-size: 17px;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 0;
    }
    [data-margin-overlay="dismiss"]:hover {
      background: rgba(15, 20, 25, 0.9);
    }
    [data-margin-overlay="label"] {
      position: fixed;
      display: none;
      align-items: center;
      gap: 5px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11.5px;
      font-weight: 700;
      color: #fff;
      background: var(--margin-accent);
      padding: 4px 11px 4px 8px;
      border-radius: 999px;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
      white-space: nowrap;
      z-index: 2147483000;
    }
    [data-margin-overlay="label-glyph"] {
      position: relative;
      width: 11px;
      height: 11px;
      display: inline-block;
      flex-shrink: 0;
    }
    [data-margin-overlay="label-glyph"]::before {
      content: "";
      position: absolute;
      left: 1px;
      top: 0;
      bottom: 0;
      width: 2px;
      border-radius: 1px;
      background: #fff;
    }
    [data-margin-overlay="label-glyph"]::after {
      content: "";
      position: absolute;
      left: 5.5px;
      right: 0;
      top: 2px;
      height: 2px;
      border-radius: 1px;
      background: #fff;
      opacity: 0.9;
      box-shadow: 0 4px 0 #fff;
    }
    [data-margin-overlay="label"].moving {
      transition: top 0.16s ease-out, left 0.16s ease-out;
    }
  `;
  document.head.appendChild(style);
}
