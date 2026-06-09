import type { ReplyContext } from '../types';

interface Props {
  context: ReplyContext;
  onClear: () => void;
}

/** Read-only display of the captured reply context. Lets the user
 *  confirm the right tweet was grabbed before generating. */
export function ReplyContextDisplay({ context, onClear }: Props) {
  return (
    <div className="reply-context">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Reply context captured</strong>
        <button type="button" onClick={onClear} aria-label="Clear captured reply context">
          Clear
        </button>
      </div>
      {context.grandparentText && (
        <div className="ctx-block">
          <div className="ctx-label">Previous in thread</div>
          <p className="ctx-text">{context.grandparentText}</p>
        </div>
      )}
      <div className="ctx-block">
        <div className="ctx-label">
          Replying to {context.targetAuthorHandle ? `@${context.targetAuthorHandle}` : ''}
        </div>
        <p className="ctx-text">{context.targetText}</p>
      </div>
      {context.hadUnreadableMedia && (
        <div className="help">
          Media (images / quoted tweets) were present but not read — v1 captures text only.
        </div>
      )}
    </div>
  );
}
