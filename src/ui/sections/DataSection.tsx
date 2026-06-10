import { useCallback, useEffect, useState } from 'react';
import { clearAllItems, EXPORT_SCHEMA_VERSION, getAllItems } from '../../storage';
import { IcCheck, IcExport, IcTrash } from '../icons';
import { isMessageOfType, onNotice } from '../../messaging';

interface Props {
  onSaved: () => void;
}

/**
 * Data section: export the corpus as JSON, or clear it entirely via
 * a two-step inline confirm.
 */
export function DataSection({ onSaved }: Props) {
  const [count, setCount] = useState<number>(0);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportedCount, setExportedCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await getAllItems();
      setCount(items.length);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:library-changed')) void refresh();
    });
    return () => unsub();
  }, [refresh]);

  async function exportJson(): Promise<void> {
    setExporting(true);
    setError(null);
    try {
      const items = await getAllItems();
      const payload = {
        exportedAt: new Date().toISOString(),
        schemaVersion: EXPORT_SCHEMA_VERSION,
        items,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `margin-voice-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportedCount(items.length);
      onSaved();
      window.setTimeout(() => setExportedCount(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function clearAll(): Promise<void> {
    setClearing(true);
    setError(null);
    try {
      // One transaction, all-or-nothing — a per-item delete loop over a
      // large corpus could fail midway and leave a half-cleared library.
      await clearAllItems();
      setConfirming(false);
      onSaved();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="opt-stack">
      <div className="opt-card">
        <div className="opt-card-title">Export your voice</div>
        <p className="opt-card-desc">
          A portable backup of every saved example, independent of this browser. Generated locally —
          nothing leaves your machine.
        </p>
        <ul className="spec-list">
          <li>
            <span>Format</span>
            <span className="mono-val">JSON · schema v{EXPORT_SCHEMA_VERSION}</span>
          </li>
          <li>
            <span>Includes</span>
            <span className="mono-val">
              {count} {count === 1 ? 'example' : 'examples'}, type & source
            </span>
          </li>
          <li>
            <span>Destination</span>
            <span className="mono-val">your downloads folder</span>
          </li>
        </ul>
        <button
          type="button"
          className="btn primary"
          disabled={count === 0 || exporting}
          onClick={() => void exportJson()}
        >
          {exportedCount !== null ? (
            <>
              <IcCheck /> Exported {exportedCount} {exportedCount === 1 ? 'item' : 'items'}
            </>
          ) : (
            <>
              <IcExport /> {exporting ? 'Exporting…' : 'Export as JSON'}
            </>
          )}
        </button>
      </div>

      <div className="opt-card danger-zone">
        <div className="opt-card-title">Clear voice library</div>
        <p className="opt-card-desc">
          Removes all {count} saved {count === 1 ? 'example' : 'examples'} from this browser. This
          can’t be undone — export first if you want a copy.
        </p>
        {!confirming ? (
          <button
            type="button"
            className="btn danger-outline"
            disabled={count === 0}
            onClick={() => setConfirming(true)}
          >
            <IcTrash /> Clear everything
          </button>
        ) : (
          <div className="confirm-row">
            <span className="help">Delete all {count}? This is permanent.</span>
            <span className="head-spacer" />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setConfirming(false)}
              disabled={clearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger-solid sm"
              onClick={() => void clearAll()}
              disabled={clearing}
            >
              {clearing ? 'Clearing…' : 'Yes, clear it'}
            </button>
          </div>
        )}
        {error && (
          <div className="status err" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
