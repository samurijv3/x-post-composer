import type { BundlePickerControls } from './types';

/**
 * The voice-seed picker (Phase 6): choose a bundle whose members become
 * the exact voice examples for the next generation, or fall back to the
 * default library sample. Always rendered — with zero bundles the
 * select truthfully shows its one current source and a hint says how to
 * get more (discoverability over hiding the power feature). Counts
 * shown are resolved member counts — what would actually be sent.
 */
export function BundlePicker({ picker }: { picker: BundlePickerControls }) {
  return (
    <div className="bundle-seed">
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
      {picker.bundles.length === 0 && (
        <p className="help seed-hint">
          No bundles yet — group saved examples into a <em>bundle</em> in Voice to hand-pick what
          shapes a draft.
        </p>
      )}
    </div>
  );
}
