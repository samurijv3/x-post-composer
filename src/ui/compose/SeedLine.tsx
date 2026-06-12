import { useEffect, useRef, useState } from 'react';
import { IcChevDown, IcCheck, IcVoice } from '../icons';
import type { BundlePickerControls } from './types';

/**
 * The collapsed voice-seed line + its popover menu (replaces the old
 * <select>): "Sounding like your library · N examples" / "Sounding
 * like “bundle” · N members". The menu states each source's mechanics
 * honestly — sampled vs in-order-exact, missing counts included — and
 * the footer carries the one rule worth knowing at pick time.
 */
export function SeedLine({
  picker,
  libraryCount,
  starCount,
}: {
  picker: BundlePickerControls;
  /** Whole-library example count for the default row. */
  libraryCount: number;
  /** Starred examples guaranteed on top (0 hides the ★ clause). */
  starCount: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-away + Escape close, standard popover hygiene.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = picker.bundles.find((b) => b.id === picker.selectedId) ?? null;
  const label = active
    ? `Sounding like “${active.name}” · ${String(active.memberCount)} ${active.memberCount === 1 ? 'member' : 'members'}`
    : `Sounding like your library · ${String(libraryCount)} ${libraryCount === 1 ? 'example' : 'examples'}`;

  return (
    <div className="seedwrap" ref={wrapRef}>
      <button
        type="button"
        className="seedline"
        title="Where the prompt's voice examples come from"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IcVoice />
        {label}
        <IcChevDown />
      </button>
      {open && (
        <div className="seedmenu" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={active === null}
            className="sm-row"
            onClick={() => {
              picker.onSelect(null);
              setOpen(false);
            }}
          >
            <div>
              <div className="t">Your library</div>
              <div className="c">
                sampled · {libraryCount} {libraryCount === 1 ? 'example' : 'examples'}
                {starCount > 0 ? ` + ★ ${String(starCount)} guaranteed` : ''}
              </div>
            </div>
            {active === null && <IcCheck className="chk" />}
          </button>
          {picker.bundles.length > 0 && <div className="sm-div" />}
          {picker.bundles.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitemradio"
              aria-checked={picker.selectedId === b.id}
              className="sm-row"
              onClick={() => {
                picker.onSelect(b.id);
                setOpen(false);
              }}
            >
              <div>
                <div className="t">{b.name}</div>
                <div className="c">
                  bundle · {b.memberCount} {b.memberCount === 1 ? 'member' : 'members'}, in order
                  {b.missingCount > 0 ? ` · ${String(b.missingCount)} missing` : ''}
                </div>
              </div>
              {picker.selectedId === b.id && <IcCheck className="chk" />}
            </button>
          ))}
          <div className="sm-foot">
            A bundle’s members become the exact voice examples — no sampling. Starred examples still
            ride on top.
          </div>
        </div>
      )}
    </div>
  );
}
