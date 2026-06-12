import { useState } from 'react';
import type { Bundle } from '../../types';
import { IcX } from '../icons';

interface AddFormProps {
  /** Existing bundles — the optional "also file into" target (hidden
   *  when none exist). */
  bundles: Bundle[];
  onAdd: (text: string, type: 'post' | 'reply', bundleId: string | null) => void;
  onCancel: () => void;
}

/**
 * Manual paste form. The "This is my own writing" confirmation is the
 * authorship gate for this path — it replaces validateAuthor, which
 * only applies to on-page captures (see messaging contract).
 */
export function AddForm({ bundles, onAdd, onCancel }: AddFormProps) {
  const [text, setText] = useState<string>('');
  const [type, setType] = useState<'post' | 'reply'>('post');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const ready = text.trim() !== '' && confirmed;
  return (
    <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="fld">
        <div className="field-row">
          <span className="fld-label">Paste your own post or reply</span>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            title="Discard"
            aria-label="Discard"
            onClick={onCancel}
          >
            <IcX />
          </button>
        </div>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="exactly as you wrote it"
        />
      </label>
      <div className="field-row">
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button
            type="button"
            className={type === 'post' ? 'active' : ''}
            onClick={() => setType('post')}
            style={{ padding: '5px 14px' }}
          >
            Post
          </button>
          <button
            type="button"
            className={type === 'reply' ? 'active' : ''}
            onClick={() => setType('reply')}
            style={{ padding: '5px 14px' }}
          >
            Reply
          </button>
        </div>
      </div>
      {bundles.length > 0 && (
        <label className="bundle-pick">
          <span className="fld-label">Also file into</span>
          <select
            value={bundleId ?? ''}
            onChange={(e) => setBundleId(e.target.value === '' ? null : e.target.value)}
            title="The saved example also joins this bundle"
          >
            <option value="">— just the library</option>
            {bundles.map((b) => (
              <option key={b.id} value={b.id}>
                Bundle: {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="switch">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="track" />
        <span className="help" style={{ color: 'var(--text-2)' }}>
          This is my own writing
        </span>
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!ready}
        onClick={() => onAdd(text.trim(), type, bundleId)}
      >
        Save to voice
      </button>
    </div>
  );
}
