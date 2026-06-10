import { useEffect, useState } from 'react';
import { getLastPrompt, subscribeLastPrompt, type LastPromptRecord } from '../storage';
import { weightedLength } from '../lib/counting';
import { IcCheck, IcCopy, IcSearch } from './icons';

/**
 * Live view of the most recent Anthropic call — System block + User
 * block + Response block, each in monospace with a Copy button.
 * Reads `chrome.storage.session.lastPrompt:v1` and subscribes for
 * live updates so it reflects refines as they fire.
 *
 * The prompt stored is the rendered template (potentially containing
 * the `===USER===` marker). We split it here for display so the
 * blocks match what was actually sent to Anthropic.
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

  async function copy(label: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // ignore
    }
  }

  function splitPrompt(prompt: string): { system: string; user: string } {
    const idx = prompt.indexOf('===USER===');
    if (idx === -1) return { system: '', user: prompt };
    return {
      system: prompt.slice(0, idx).trim(),
      user: prompt.slice(idx + '===USER==='.length).trim(),
    };
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
            const { system, user } = splitPrompt(record.prompt);
            const ageMs = Date.now() - record.timestamp;
            const minutes = Math.floor(ageMs / 60000);
            const seconds = Math.floor(ageMs / 1000);
            const when = minutes > 0 ? `${minutes} min ago` : `${seconds} sec ago`;
            const blocks = [
              { label: 'System', text: system, response: false as const },
              { label: 'User', text: user, response: false as const },
              { label: 'Response', text: record.response, response: true as const },
            ];
            return (
              <div className="inspector" style={{ marginTop: 12, paddingTop: 0, borderTop: 0 }}>
                <div className="insp-meta">
                  <span className={`badge ${record.mode === 'reply' ? 'reply' : 'post'}`}>
                    {record.mode}
                  </span>
                  {record.wasRepaired && <span className="badge warn">repaired</span>}
                  <span className="help">sent {when}</span>
                </div>
                {record.wasRepaired && record.repairContext && (
                  <p className="help">
                    Repair targeted: {record.repairContext.replace(/\n/g, ' · ')}
                  </p>
                )}
                {blocks.map((b) => (
                  <div key={b.label} className={`insp-block ${b.response ? 'is-response' : ''}`}>
                    <div className="insp-head">
                      <span className="insp-label">{b.label}</span>
                      <span className="insp-count">
                        {b.text === '' ? '0' : weightedLength(b.text)} chars
                      </span>
                      <button
                        type="button"
                        className="insp-copy"
                        onClick={() => void copy(b.label, b.text)}
                        disabled={b.text === ''}
                      >
                        {copied === b.label ? (
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
                    <pre className="insp-pre">{b.text === '' ? '(empty)' : b.text}</pre>
                  </div>
                ))}
              </div>
            );
          })()
        ))}
    </div>
  );
}
