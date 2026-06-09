import { useState } from 'react';
import type { ChipPreset, Settings } from '../types';

interface Props {
  chips: ChipPreset[];
  onSave: (next: ChipPreset[]) => Promise<void> | void;
}

/**
 * CRUD for the refine chips. Each chip has a label (button text in the
 * Composer) and an instruction (the text injected into the chipRefine
 * template). Order is preserved via ↑ / ↓.
 *
 * The instruction goes through the `chipRefine` template at refine
 * time, so editing the chip wording here and editing the template body
 * in the Prompts section above are independent levers.
 */
export function ChipManager({ chips, onSave }: Props) {
  const [working, setWorking] = useState<ChipPreset[]>(chips);
  const [dirty, setDirty] = useState<boolean>(false);

  // Keep `working` in sync if the parent settings reload (e.g. after
  // another tab saved chips first).
  if (!dirty && JSON.stringify(working) !== JSON.stringify(chips)) {
    setWorking(chips);
  }

  function patch(idx: number, partial: Partial<ChipPreset>): void {
    const next = working.map((c, i) => (i === idx ? { ...c, ...partial } : c));
    setWorking(next);
    setDirty(true);
  }

  function move(idx: number, direction: -1 | 1): void {
    const target = idx + direction;
    if (target < 0 || target >= working.length) return;
    const next = [...working];
    const a = next[idx];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[idx] = b;
    next[target] = a;
    setWorking(next);
    setDirty(true);
  }

  function remove(idx: number): void {
    if (!window.confirm(`Delete chip "${working[idx]?.label ?? ''}"?`)) return;
    setWorking(working.filter((_, i) => i !== idx));
    setDirty(true);
  }

  function add(): void {
    setWorking([
      ...working,
      {
        id: `chip-${String(Date.now())}`,
        label: 'New chip',
        instruction: 'Describe what this chip should ask the model to change.',
      },
    ]);
    setDirty(true);
  }

  async function save(): Promise<void> {
    await onSave(working);
    setDirty(false);
  }

  function discard(): void {
    setWorking(chips);
    setDirty(false);
  }

  return (
    <div className="chip-manager">
      {working.length === 0 && (
        <div className="stub">No chips. Add one below.</div>
      )}
      {working.map((chip, idx) => (
        <div key={chip.id} className="chip-row">
          <div className="row">
            <span className="ctx-label">#{idx + 1}</span>
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === working.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button type="button" onClick={() => remove(idx)} aria-label="Delete chip">
              Delete
            </button>
          </div>
          <div className="field">
            <label>Label (button text)</label>
            <input
              type="text"
              value={chip.label}
              onChange={(e) => patch(idx, { label: e.target.value })}
              spellCheck={false}
              maxLength={40}
            />
          </div>
          <div className="field">
            <label>Instruction (sent to the model in place of {'{{instruction}}'})</label>
            <textarea
              rows={2}
              value={chip.instruction}
              onChange={(e) => patch(idx, { instruction: e.target.value })}
              spellCheck={true}
            />
          </div>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={add}>
          Add chip
        </button>
        <button className="primary" type="button" onClick={() => void save()} disabled={!dirty}>
          Save chips
        </button>
        {dirty && (
          <button type="button" onClick={discard}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

export type ChipsValue = Settings['chips'];
