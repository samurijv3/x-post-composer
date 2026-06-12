import { useState } from 'react';
import type { Bundle, LibraryItem } from '../../types';
import { resolveBundleMembers } from '../../lib/bundles';
import { IcChevDown, IcChevR, IcEdit, IcTrash, IcX } from '../icons';

interface BundleSectionProps {
  bundles: Bundle[];
  /** Current library, for resolving members and showing honest counts. */
  items: LibraryItem[];
  onRename: (bundle: Bundle, name: string) => void;
  onRemoveMember: (bundle: Bundle, itemId: string) => void;
  onDelete: (bundle: Bundle) => void;
}

/**
 * The saved-bundles list on the Voice screen — deliberately quiet
 * management for a power feature: expand a bundle to see (and prune)
 * its members, rename inline, delete. Member counts are honest: ids
 * whose items were deleted from the library show as "missing" rather
 * than being silently absorbed.
 */
export function BundleSection({
  bundles,
  items,
  onRename,
  onRemoveMember,
  onDelete,
}: BundleSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (bundles.length === 0) return null;
  return (
    <div className="bundle-section">
      <span className="eyebrow">Bundles</span>
      <p className="help" style={{ marginTop: 2 }}>
        Pick one in Compose to seed a draft from these exact tweets instead of the usual sample.
      </p>
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
            onDelete={() => onDelete(b)}
          />
        ))}
      </ul>
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
  onDelete: () => void;
}

function BundleRow({
  bundle,
  items,
  open,
  onToggle,
  onRename,
  onRemoveMember,
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
              <span className="bundle-member-text">{m.text}</span>
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
