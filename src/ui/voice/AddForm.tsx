import { useState } from 'react';
import type { Bundle } from '../../types';
import { IcX } from '../icons';
import { BundleTargetSelect } from './BundleTargetSelect';

interface AddFormProps {
  /** Existing bundles for the optional "also file into" target. */
  bundles: Bundle[];
  /** Mint an empty bundle inline (the select's "+ New bundle…"). */
  onCreateBundle: (name: string) => Promise<string | null>;
  onAdd: (text: string, type: 'post' | 'reply' | 'thread', bundleId: string | null) => void;
  onCancel: () => void;
}

/**
 * Manual paste form. The "This is my own writing" confirmation is the
 * authorship gate for this path — it replaces validateAuthor, which
 * only applies to on-page captures (see messaging contract).
 */
export function AddForm({ bundles, onCreateBundle, onAdd, onCancel }: AddFormProps) {
  const [text, setText] = useState<string>('');
  const [type, setType] = useState<'post' | 'reply' | 'thread'>('post');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const ready = text.trim() !== '' && confirmed;
  return (
    <div className="addform">
      <label className="fld">
        <div className="field-row">
          <span className="af-title">Add your own writing</span>
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
          className={type === 'thread' ? 'af-mono' : ''}
          rows={type === 'thread' ? 6 : 3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            type === 'thread'
              ? 'paste the whole thread — separate posts with a line containing only ---'
              : 'exactly as you wrote it'
          }
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
          <button
            type="button"
            className={type === 'thread' ? 'active' : ''}
            title="A thread — posts separated by a line containing only ---"
            onClick={() => setType('thread')}
            style={{ padding: '5px 14px' }}
          >
            Thread
          </button>
        </div>
      </div>
      <BundleTargetSelect
        label="Also file into"
        bundles={bundles}
        value={bundleId}
        onChange={setBundleId}
        onCreateBundle={onCreateBundle}
      />
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
        className="btn dark block"
        disabled={!ready}
        onClick={() => onAdd(text.trim(), type, bundleId)}
      >
        Save to voice
      </button>
    </div>
  );
}
