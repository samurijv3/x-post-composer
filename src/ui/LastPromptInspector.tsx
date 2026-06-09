import { useEffect, useState } from 'react';
import { subscribeLastPrompt, type LastPromptRecord } from '../storage';

/**
 * Transparency surface — the exact text last sent to Anthropic and what
 * came back. Updates live as new generations land. Nothing hidden, no
 * trimming, no editorialising (CLAUDE.md §1).
 */
export function LastPromptInspector() {
  const [record, setRecord] = useState<LastPromptRecord | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = subscribeLastPrompt(setRecord);
    return () => unsubscribe();
  }, []);

  if (!record) {
    return (
      <div className="stub">
        No generation in this session yet. Generate something from the side panel and the exact
        prompt + response will appear here.
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <span className={`badge badge-${record.mode}`}>{record.mode}</span>
          {record.wasRepaired && (
            <span className="badge badge-warn" title="Repair pass fired">
              repaired
            </span>
          )}
          <span className="badge">{new Date(record.timestamp).toLocaleTimeString()}</span>
        </div>
        <button type="button" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {record.wasRepaired && record.repairContext && (
        <div className="help">
          Repair targeted: {record.repairContext.replace(/\n/g, ' · ')}
        </div>
      )}

      {expanded && (
        <>
          <div className="inspector-section">
            <div className="ctx-label">Prompt sent</div>
            <pre className="raw-text">{record.prompt}</pre>
          </div>
          <div className="inspector-section">
            <div className="ctx-label">Response received</div>
            <pre className="raw-text">{record.response}</pre>
          </div>
        </>
      )}
    </div>
  );
}
