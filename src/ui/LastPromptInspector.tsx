import { useEffect, useState } from 'react';
import { getLastPrompt, subscribeLastPrompt, type LastPromptRecord } from '../storage';
import { weightedLength } from '../lib/counting';
import { IcCheck, IcChevR, IcCopy } from './icons';

/**
 * Live view of the most recent pipeline invocation — every Anthropic
 * call in order (generate/refine, then the optional repair and tighten
 * passes), each as a collapsible section holding its System + User
 * pair, with the final Response always visible. Reads
 * `chrome.storage.session.lastPrompt:v2` and subscribes for live
 * updates so it reflects refines as they fire.
 *
 * A single-call invocation opens expanded (one click to the content);
 * multi-call chains start collapsed so the chain reads as a summary
 * first. The record is written by the pipeline at send time, so the
 * blocks shown match what was actually sent to Anthropic byte for
 * byte — transparency is load-bearing (design.md).
 */
export function LastPromptInspector() {
  const [open, setOpen] = useState<boolean>(false);
  const [record, setRecord] = useState<LastPromptRecord | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openCalls, setOpenCalls] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    void getLastPrompt().then(setRecord);
    const unsub = subscribeLastPrompt(setRecord);
    return () => unsub();
  }, []);

  // New invocation → reset the accordion: a lone call opens itself,
  // a chain starts collapsed.
  useEffect(() => {
    if (record === null) return;
    setOpenCalls(record.calls.length === 1 ? new Set([0]) : new Set());
  }, [record]);

  function toggleCall(i: number): void {
    setOpenCalls((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

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
    <div className={`inspect-section ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="inspect-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="See exactly what was sent to the model and what came back"
      >
        <span style={{ flex: 1, textAlign: 'left' }}>
          {open ? 'Hide last prompt' : 'Inspect last prompt'}
        </span>
        <IcChevR className={`insp-chev ${open ? 'open' : ''}`} />
      </button>
      {open &&
        (record === null ? (
          <p className="help inspect-body">No generation in this session yet.</p>
        ) : (
          (() => {
            const ageMs = Date.now() - record.timestamp;
            const minutes = Math.floor(ageMs / 60000);
            const seconds = Math.floor(ageMs / 1000);
            const when = minutes > 0 ? `${minutes} min ago` : `${seconds} sec ago`;
            return (
              <div className="inspector inspect-body" style={{ margin: 0, borderTop: 0 }}>
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
                {record.calls.map((call, i) => {
                  const isOpen = openCalls.has(i);
                  return (
                    <div key={`call-${String(i)}`} className={`insp-call ${isOpen ? 'open' : ''}`}>
                      <button
                        type="button"
                        className="insp-call-head"
                        aria-expanded={isOpen}
                        onClick={() => toggleCall(i)}
                      >
                        <IcChevR className="insp-call-chev" />
                        <span className="insp-call-title">
                          Call {i + 1} · {call.label}
                        </span>
                        <span className="insp-count">
                          {weightedLength(call.system) + weightedLength(call.user)} chars
                        </span>
                      </button>
                      {isOpen && (
                        <div className="insp-call-body">
                          {block(`${String(i)}:system`, 'System', call.system)}
                          {block(`${String(i)}:user`, 'User', call.user)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {block('response', 'Response', record.response, true)}
              </div>
            );
          })()
        ))}
    </div>
  );
}
