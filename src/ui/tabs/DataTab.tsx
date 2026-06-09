import { useState } from 'react';
import { getAllItems } from '../../storage';

/**
 * Data tab. In Chunk 2 it exposes one feature: download the full
 * library as JSON so the user always has a portable backup (CLAUDE.md
 * §7). Future chunks may add an import path back, settings export, etc.
 */
export function DataTab() {
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);

  async function exportJson(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const items = await getAllItems();
      const payload = {
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        items,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `x-post-composer-library-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setLastCount(items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <section>
        <h2>Export library</h2>
        <p className="help">
          Downloads every item in your library as JSON so you always have a portable backup,
          independent of this browser. Nothing leaves your machine — the file is generated locally
          and saved to your downloads folder.
        </p>
        <button className="primary" type="button" onClick={() => void exportJson()} disabled={busy}>
          {busy ? 'Exporting…' : 'Export library as JSON'}
        </button>
        {lastCount !== null && !error && (
          <div className="status ok">Exported {String(lastCount)} items.</div>
        )}
        {error && <div className="status err">{error}</div>}
      </section>
    </div>
  );
}
