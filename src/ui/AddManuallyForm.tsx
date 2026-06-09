import { useState } from 'react';
import { sendToBackground } from '../messaging';
import type { BackgroundReply } from '../messaging';

interface Props {
  /** Called after a successful add so the parent can re-fetch the library. */
  onAdded: () => void;
}

/**
 * Manual-paste path. The author cannot be validated on raw paste, so
 * the form requires the user to confirm that what they're pasting is
 * their own writing. The text + type are sent to the background which
 * persists the item.
 */
export function AddManuallyForm({ onAdded }: Props) {
  const [text, setText] = useState<string>('');
  const [itemType, setItemType] = useState<'post' | 'reply'>('post');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:add-manual-result' }>
      >({ type: 'panel:add-manual-item', text, itemType });
      if (!reply.ok) {
        setError(reply.message);
        return;
      }
      setText('');
      setItemType('post');
      setConfirmed(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const ready = text.trim() !== '' && confirmed;

  return (
    <form className="add-form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="addText">Paste your own post or reply</label>
        <textarea
          id="addText"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Exactly as you wrote it on X."
          spellCheck={false}
        />
      </div>
      <div className="row">
        <label>
          Type{' '}
          <select value={itemType} onChange={(e) => setItemType(e.target.value as 'post' | 'reply')}>
            <option value="post">Post</option>
            <option value="reply">Reply</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm this is my own writing.</span>
        </label>
      </div>
      <button className="primary" type="submit" disabled={!ready || saving}>
        {saving ? 'Adding…' : 'Add to library'}
      </button>
      {error && <div className="status err">{error}</div>}
    </form>
  );
}
