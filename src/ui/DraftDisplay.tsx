import { useState } from 'react';
import type { Span } from '../lib/exclusion';
import type { Draft } from '../types';
import { weightedLength, X_HARD_LIMIT } from '../lib/counting';
import { renderWithHighlights } from './highlights';

interface Props {
  draft: Draft;
  residualViolations: Span[];
  wasRepaired: boolean;
  /** When true, render the ≤280 gate per post. */
  charCap: boolean;
}

/**
 * Renders every post in the draft (v1: length 1) with its own X-weighted
 * counter and Copy button. Iterating over `.posts` rather than reaching
 * for `.posts[0]` keeps thread mode a no-refactor add (CLAUDE.md §8).
 *
 * Output is clipboard-only — the extension never writes X's DOM and
 * never auto-posts (CLAUDE.md §6). The user pastes into the already-open
 * compose box and finishes by hand.
 */
export function DraftDisplay({ draft, residualViolations, wasRepaired, charCap }: Props) {
  return (
    <div className="draft">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Draft</strong>
        {wasRepaired && (
          <span className="badge badge-warn" title="A repair or tighten pass fired">
            repaired
          </span>
        )}
      </div>
      {draft.posts.map((post, idx) => (
        <PostBlock
          key={idx}
          text={post.text}
          // For v1 (single post) all violations belong to this post. Once
          // thread mode lands, the orchestrator will return spans tagged
          // with a post index and we'll filter here.
          residualViolations={residualViolations}
          charCap={charCap}
        />
      ))}
    </div>
  );
}

interface PostBlockProps {
  text: string;
  residualViolations: Span[];
  charCap: boolean;
}

function PostBlock({ text, residualViolations, charCap }: PostBlockProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const weighted = weightedLength(text);
  const overLimit = charCap && weighted > X_HARD_LIMIT;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="post-block">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span
          className={`badge ${overLimit ? 'badge-warn' : ''}`}
          title="X-weighted character count (URLs count as 23; some chars weigh 2)"
        >
          {weighted}
          {charCap ? `/${X_HARD_LIMIT}` : ' chars'}
        </span>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="draft-text">{renderWithHighlights(text, residualViolations)}</div>
      {overLimit && (
        <div className="status err">
          Over 280 by {weighted - X_HARD_LIMIT}. The tighten pass already ran; you can edit by
          hand or hit Regenerate.
        </div>
      )}
      {residualViolations.length > 0 && (
        <div className="help">
          Highlighted spans are patterns the model could not avoid after one repair pass. Edit
          by hand before posting, or relax the rule in <em>Output rules</em>.
        </div>
      )}
    </div>
  );
}
