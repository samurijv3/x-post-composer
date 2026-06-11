import { useEffect, useState } from 'react';
import { getLastPrompt, subscribeLastPrompt, type LastPromptRecord } from '../storage';
import { weightedLength } from '../lib/counting';
import { IcCheck, IcCopy, IcSearch } from './icons';

/**
 * Live view of the most recent pipeline invocation — every Anthropic
 * call in order (generate/refine, then the optional repair and tighten
 * passes), each as a labelled System + User pair, with the final
 * Response last. Reads `chrome.storage.session.lastPrompt:v2` and
 * subscribes for live updates so it reflects refines as they fire.
 *
 * The record is written by the pipeline at send time, so the blocks
 * shown match what was actually sent to Anthropic byte for byte —
 * transparency is load-bearing (design.md).
 */
export function LastPromptInspector() {
  const [open, setOpen] = useState<boolean>(false);
  const [record, setRecord] = useState<LastPromptRecord | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void getLastPrompt().then(setRecord);
    const unsub = subscribeLastPrompt(setRecord);
    return () => unsub();
  }, []);

  async function copy(key: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // ignore
    }
  }

  function block(key: string, label: string, text: string, isResponse = false) {
    return (
      <div key={key} className={`insp-block ${isResponse ? 'is-response' : ''}`}>
        <div className="insp-head">
          <span className="insp-label">{label}</span>
          <span className="insp-count">{text === '' ? '0' : weightedLength(text)} chars</span>
          <button
            type="button"
            className="insp-copy"
            onClick={() => void copy(key, text)}
            disabled={text === ''}
          >
            {copied === key ? (
              <>
                <IcCheck /> Copied
              </>
            ) : (
              <>
                <IcCopy /> Copy
              </>
            )}
          </button>
        </div>
        <pre className="insp-pre">{text === '' ? '(empty)' : text}</pre>
      </div>
    );
  }

  return (
    <div className="inspect-section">
      <button
        type="button"
        className="inspect-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <IcSearch />
        <span style={{ flex: 1, textAlign: 'left' }}>
          {open ? 'Hide last prompt' : 'Inspect last prompt'}
        </span>
        <span className="help">{open ? 'collapse' : 'see what was sent and what came back'}</span>
      </button>
      {open &&
        (record === null ? (
          <p className="help" style={{ marginTop: 10 }}>
            No generation in this session yet.
          </p>
        ) : (
          (() => {
            const ageMs = Date.now() - record.timestamp;
            const minutes = Math.floor(ageMs / 60000);
            const seconds = Math.floor(ageMs / 1000);
            const when = minutes > 0 ? `${minutes} min ago` : `${seconds} sec ago`;
            return (
              <div className="inspector" style={{ marginTop: 12, paddingTop: 0, borderTop: 0 }}>
                <div className="insp-meta">
                  <span className={`badge ${record.mode === 'reply' ? 'reply' : 'post'}`}>
                    {record.mode}
                  </span>
                  {record.wasRepaired && <span className="badge warn">repaired</span>}
                  <span className="help">
                    {record.calls.length === 1 ? '1 call' : `${record.calls.length} calls`} · sent{' '}
                    {when}
                  </span>
                </div>
                {record.calls.map((call, i) => (
                  <div key={`call-${String(i)}`}>
                    <span className="eyebrow" style={{ display: 'block', margin: '10px 0 4px' }}>
                      Call {i + 1} — {call.label}
                    </span>
                    {block(`${String(i)}:system`, 'System', call.system)}
                    {block(`${String(i)}:user`, 'User', call.user)}
                  </div>
                ))}
                <span className="eyebrow" style={{ display: 'block', margin: '10px 0 4px' }}>
                  Final response
                </span>
                {block('response', 'Response', record.response, true)}
              </div>
            );
          })()
        ))}
    </div>
  );
}
