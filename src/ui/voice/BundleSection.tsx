import { useState } from 'react';
import type { Bundle, LibraryItem } from '../../types';
import { resolveBundleMembers } from '../../lib/bundles';
import { IcChevDown, IcChevR, IcChevUp, IcEdit, IcPlus, IcTrash, IcX } from '../icons';

interface BundleCreation {
  name: string;
  setName: (v: string) => void;
  /** Destination: an existing bundle's id that the picks append to,
   *  or null for a brand-new bundle (named via `name`). */
  target: string | null;
  setTarget: (v: string | null) => void;
  pickedCount: number;
  /** New bundle: name required (picks optional — empty is a valid
   *  start). Existing bundle: at least one pick. Decided by the owner. */
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
}

interface BundleSectionProps {
  bundles: Bundle[];
  /** Current library, for resolving members and showing honest counts. */
  items: LibraryItem[];
  open: boolean;
  onToggleOpen: () => void;
  /** Starts bundle-building selection mode targeting a NEW bundle.
   *  Null hides the + (picking already active). */
  onStartPicking: (() => void) | null;
  /** Starts selection mode targeting an existing bundle (its row's +).
   *  Null hides the per-row control (picking active, or empty library). */
  onAddMembers: ((bundle: Bundle) => void) | null;
  /** Non-null while selection mode is active — renders the name/save
   *  bar inside this section, where the new bundle will appear. */
  creation: BundleCreation | null;
  onRename: (bundle: Bundle, name: string) => void;
  onRemoveMember: (bundle: Bundle, itemId: string) => void;
  /** Reveal a member's row in Saved examples (scroll + flash) — the
   *  same path as the duplicate banner's "Show me". */
  onLocateMember: (itemId: string) => void;
  /** Move a member one visible step (order shapes the prompt — the
   *  members render as a numbered sequence). */
  onMoveMember: (bundle: Bundle, itemId: string, direction: 'up' | 'down') => void;
  onDelete: (bundle: Bundle) => void;
}

/**
 * The Bundles section of the Voice screen — a sibling of Saved
 * examples with the same header pattern (chevron + count + the
 * section's own action button). Always rendered so the create entry
 * point lives where the result appears; the list is height-bounded
 * (internal scroll) so a pile of bundles can never shove the examples
 * off-screen. Member counts are honest: ids whose items were deleted
 * show as "missing" rather than being silently absorbed.
 */
export function BundleSection({
  bundles,
  items,
  open,
  onToggleOpen,
  onStartPicking,
  onAddMembers,
  creation,
  onRename,
  onRemoveMember,
  onLocateMember,
  onMoveMember,
  onDelete,
}: BundleSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="bundle-section">
      <div className="sec-head">
        <button
          type="button"
          className="sec-toggle"
          aria-expanded={open}
          onClick={onToggleOpen}
          title={open ? 'Collapse bundles' : 'Show bundles'}
        >
          {open ? <IcChevDown /> : <IcChevR />}
          <span className="eyebrow">Bundles{bundles.length > 0 ? ` · ${bundles.length}` : ''}</span>
        </button>
        <span className="head-spacer" />
        {onStartPicking && (
          <button
            type="button"
            className="icon-btn"
            title="New bundle — pick specific tweets as a reusable voice seed"
            aria-label="New bundle"
            onClick={onStartPicking}
          >
            <IcPlus />
          </button>
        )}
      </div>

      {open && creation && (
        <div className="pickbar">
          <span className="eyebrow">{creation.target === null ? 'New bundle' : 'Add tweets'}</span>
          <p className="help" style={{ margin: '4px 0 8px' }}>
            {creation.target === null
              ? 'Tap tweets below in the order you want them — or save it empty and fill it from X with the capture banner’s “Also file into”.'
              : 'Tap tweets below to add them — they append at the end of the bundle. Checked rows are already in it.'}
          </p>
          {bundles.length > 0 && (
            <label className="bundle-pick" style={{ marginBottom: 8 }}>
              <span className="fld-label">Into</span>
              <select
                value={creation.target ?? ''}
                onChange={(e) => creation.setTarget(e.target.value === '' ? null : e.target.value)}
                title="Where the tapped tweets go"
              >
                <option value="">New bundle…</option>
                {bundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bundle: {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field-row">
            {creation.target === null && (
              <input
                className="bundle-name-input"
                placeholder="Bundle name — e.g. “Day X series”"
                value={creation.name}
                autoFocus
                onChange={(e) => creation.setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') creation.onSave();
                  if (e.key === 'Escape') creation.onCancel();
                }}
              />
            )}
            <button
              type="button"
              className="btn primary sm"
              disabled={!creation.canSave}
              onClick={creation.onSave}
            >
              {creation.target === null ? 'Create' : 'Add'}
              {creation.pickedCount > 0 ? ` (${creation.pickedCount})` : ''}
            </button>
            <button type="button" className="btn ghost sm" onClick={creation.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && bundles.length === 0 && !creation && (
        <p className="help" style={{ margin: 0 }}>
          A bundle seeds a draft from specific tweets — e.g. a “day X” series — instead of the usual
          sample. Start one with <strong>+</strong>.
        </p>
      )}

      {open && bundles.length > 0 && (
        <div className="bundle-scroll">
          <ul className="bundle-list">
            {bundles.map((b) => (
              <BundleRow
                key={b.id}
                bundle={b}
                items={items}
                open={openId === b.id}
                onToggle={() => setOpenId(openId === b.id ? null : b.id)}
                onRename={(name) => onRename(b, name)}
                onRemoveMember={(itemId) => onRemoveMember(b, itemId)}
                onLocateMember={onLocateMember}
                onMoveMember={(itemId, dir) => onMoveMember(b, itemId, dir)}
                onAddMembers={onAddMembers ? () => onAddMembers(b) : null}
                onDelete={() => onDelete(b)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface BundleRowProps {
  bundle: Bundle;
  items: LibraryItem[];
  open: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRemoveMember: (itemId: string) => void;
  onLocateMember: (itemId: string) => void;
  onMoveMember: (itemId: string, direction: 'up' | 'down') => void;
  onAddMembers: (() => void) | null;
  onDelete: () => void;
}

function BundleRow({
  bundle,
  items,
  open,
  onToggle,
  onRename,
  onRemoveMember,
  onLocateMember,
  onMoveMember,
  onAddMembers,
  onDelete,
}: BundleRowProps) {
  const [renaming, setRenaming] = useState<boolean>(false);
  const [name, setName] = useState<string>(bundle.name);
  const { members, missingCount } = resolveBundleMembers(bundle.memberIds, items);

  function commitRename(): void {
    const trimmed = name.trim();
    if (trimmed !== '' && trimmed !== bundle.name) onRename(trimmed);
    else setName(bundle.name);
    setRenaming(false);
  }

  return (
    <li className="bundle-row">
      <div className="bundle-head">
        {renaming ? (
          <input
            className="bundle-rename"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setName(bundle.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="bundle-toggle"
            aria-expanded={open}
            onClick={onToggle}
            title={open ? 'Collapse' : 'Show members'}
          >
            {open ? <IcChevDown /> : <IcChevR />}
            <span className="bundle-name">{bundle.name}</span>
            <span className="help">
              {members.length} {members.length === 1 ? 'member' : 'members'}
              {missingCount > 0 && ` · ${missingCount} missing`}
            </span>
          </button>
        )}
        <span className="head-spacer" />
        {onAddMembers && (
          <button
            type="button"
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            title="Add saved tweets to this bundle"
            aria-label="Add saved tweets to this bundle"
            onClick={onAddMembers}
          >
            <IcPlus />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          title="Rename bundle"
          aria-label="Rename bundle"
          onClick={() => {
            setName(bundle.name);
            setRenaming(true);
          }}
        >
          <IcEdit />
        </button>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          title="Delete bundle (members stay in your library)"
          aria-label="Delete bundle"
          onClick={onDelete}
        >
          <IcTrash />
        </button>
      </div>
      {open && (
        <ul className="bundle-members">
          {members.map((m, idx) => (
            <li key={m.id} className="bundle-member">
              <span className="pick-badge static">{idx + 1}</span>
              <button
                type="button"
                className="bundle-member-text"
                title="Show this tweet in Saved examples"
                onClick={() => onLocateMember(m.id)}
              >
                {m.text}
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Move up"
                aria-label="Move up"
                disabled={idx === 0}
                onClick={() => onMoveMember(m.id, 'up')}
              >
                <IcChevUp />
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Move down"
                aria-label="Move down"
                disabled={idx === members.length - 1}
                onClick={() => onMoveMember(m.id, 'down')}
              >
                <IcChevDown />
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Remove from this bundle (stays in your library)"
                aria-label="Remove from this bundle"
                onClick={() => onRemoveMember(m.id)}
              >
                <IcX />
              </button>
            </li>
          ))}
          {missingCount > 0 && (
            <li className="bundle-member missing">
              <span className="help">
                {missingCount} {missingCount === 1 ? 'member was' : 'members were'} deleted from the
                library — they’re skipped when this bundle seeds a draft, and restored if you undo
                the delete.
              </span>
            </li>
          )}
          {members.length === 0 && missingCount === 0 && (
            <li className="bundle-member missing">
              <span className="help">Empty bundle — seeding from it sends no voice examples.</span>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
