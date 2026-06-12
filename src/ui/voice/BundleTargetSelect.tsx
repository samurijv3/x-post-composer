import { useState } from 'react';
import type { Bundle } from '../../types';

/** Sentinel option value for "create a new bundle inline". Never a
 *  real id (real ids are uuids). */
const NEW_SENTINEL = '__new__';

interface BundleTargetSelectProps {
  /** Control label, e.g. "Also file into". */
  label: string;
  bundles: Bundle[];
  /** The selected bundle id, or null for "just the library". */
  value: string | null;
  onChange: (bundleId: string | null) => void;
  /** Create an empty bundle with this name and return its id (null on
   *  failure) — the owner persists and refreshes; the new bundle
   *  becomes the selection here. */
  onCreateBundle: (name: string) => Promise<string | null>;
}

/**
 * The "file into a bundle" target select shared by the capture banner
 * and the manual-paste form. Includes "+ New bundle…", which swaps in
 * an inline name field — the from-X workflow can mint its destination
 * without a detour through the Bundles section.
 */
export function BundleTargetSelect({
  label,
  bundles,
  value,
  onChange,
  onCreateBundle,
}: BundleTargetSelectProps) {
  const [creating, setCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const id = await onCreateBundle(trimmed);
    if (id !== null) {
      onChange(id);
      setCreating(false);
      setName('');
    }
  }

  function cancel(): void {
    setCreating(false);
    setName('');
  }

  if (creating) {
    return (
      <div className="bundle-pick">
        <span className="fld-label">{label}</span>
        <input
          className="bundle-name-input"
          placeholder="New bundle name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
            if (e.key === 'Escape') cancel();
          }}
        />
        <button
          type="button"
          className="btn primary sm"
          disabled={name.trim() === ''}
          onClick={() => void create()}
        >
          Create
        </button>
        <button type="button" className="btn ghost sm" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <label className="bundle-pick">
      <span className="fld-label">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === NEW_SENTINEL) setCreating(true);
          else onChange(e.target.value === '' ? null : e.target.value);
        }}
        title="The saved tweet also joins this bundle"
      >
        <option value="">— just the library</option>
        {bundles.map((b) => (
          <option key={b.id} value={b.id}>
            Bundle: {b.name}
          </option>
        ))}
        <option value={NEW_SENTINEL}>+ New bundle…</option>
      </select>
    </label>
  );
}
