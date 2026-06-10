import { useEffect, useState } from 'react';
import type { ChipPreset } from '../../../types';
import { IcPlus, IcTrash } from '../../icons';

interface ChipEditorProps {
  chips: ChipPreset[];
  defaultChips: ChipPreset[];
  onSave: (next: ChipPreset[]) => void;
}

/** Inline editor for the refine chips (label + instruction per chip). */
export function ChipEditor({ chips, defaultChips, onSave }: ChipEditorProps) {
  const [working, setWorking] = useState<ChipPreset[]>(chips);
  useEffect(() => {
    setWorking(chips);
  }, [chips]);

  // Text edits buffer locally and persist on blur — saving the whole
  // settings record per keystroke spammed storage writes, re-rendered
  // every subscriber, and flashed "Saved" continuously. Structural
  // changes (add/remove/reset) still save immediately.
  function patch(idx: number, p: Partial<ChipPreset>): void {
    setWorking(working.map((c, i) => (i === idx ? { ...c, ...p } : c)));
  }
  function commitEdits(): void {
    // `working` and `chips` share a reference exactly when nothing is
    // edited (the sync effect above), so this skips no-op saves.
    if (working !== chips) onSave(working);
  }
  function remove(idx: number): void {
    const next = working.filter((_, i) => i !== idx);
    setWorking(next);
    onSave(next);
  }
  function add(): void {
    const next = [
      ...working,
      {
        id: `chip-${String(Date.now())}`,
        label: '',
        instruction: '',
      },
    ];
    setWorking(next);
    onSave(next);
  }
  function reset(): void {
    setWorking(defaultChips);
    onSave(defaultChips);
  }

  return (
    <div className="opt-card">
      <div className="opt-card-head">
        <div>
          <div className="opt-card-title">Refine chips</div>
          <p className="opt-card-desc">
            Each becomes a one-tap button under a draft. The label shows on the chip; the
            instruction is what the model is told.
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <div className="chip-editor">
        <div className="chip-edit-head">
          <span>Label</span>
          <span>Instruction sent to the model</span>
          <span />
        </div>
        {working.map((c, idx) => (
          <div key={c.id} className="chip-edit-row">
            <input
              type="text"
              value={c.label}
              placeholder="Shorter"
              onChange={(e) => patch(idx, { label: e.target.value })}
              onBlur={commitEdits}
            />
            <input
              type="text"
              value={c.instruction}
              placeholder="Cut it down. Keep only the sharpest line."
              onChange={(e) => patch(idx, { instruction: e.target.value })}
              onBlur={commitEdits}
            />
            <button
              type="button"
              className="icon-btn"
              title="Remove chip"
              aria-label="Remove chip"
              onClick={() => remove(idx)}
            >
              <IcTrash />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={add}>
        <IcPlus /> Add chip
      </button>
    </div>
  );
}
