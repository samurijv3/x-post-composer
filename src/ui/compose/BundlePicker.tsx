import type { BundlePickerControls } from './types';

/**
 * The voice-seed picker (Phase 6): choose a bundle whose members become
 * the exact voice examples for the next generation, or fall back to the
 * default library sample. Rendered only when bundles exist; the counts
 * shown are resolved member counts — what would actually be sent.
 */
export function BundlePicker({ picker }: { picker: BundlePickerControls }) {
  return (
    <label className="bundle-pick">
      <span className="fld-label">Voice seed</span>
      <select
        value={picker.selectedId ?? ''}
        onChange={(e) => picker.onSelect(e.target.value === '' ? null : e.target.value)}
        title="Where the prompt's voice examples come from"
      >
        <option value="">Sampled from your library</option>
        {picker.bundles.map((b) => (
          <option key={b.id} value={b.id}>
            Bundle: {b.name} ({b.memberCount} {b.memberCount === 1 ? 'member' : 'members'})
          </option>
        ))}
      </select>
    </label>
  );
}
