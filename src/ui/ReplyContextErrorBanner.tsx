import { IcWarn, IcX } from './icons';

export type ReplyContextErrorKind = 'truncated' | 'media-only' | 'unknown';

export interface ReplyContextError {
  kind: ReplyContextErrorKind;
  stamp: number;
}

interface Props {
  error: ReplyContextError;
  onDismiss: () => void;
}

/**
 * Banner for reply-context-pull failures. Uses the same `.save-result`
 * chrome as SaveResultBanner so the two failure channels share one
 * visual treatment — only the wording differs.
 */
export function ReplyContextErrorBanner({ error, onDismiss }: Props) {
  const { tone, title, msg } = contentFor(error.kind);
  return (
    <div className={`save-result ${tone}`} role="status" key={error.stamp}>
      <span className="sr-ic">
        <IcWarn />
      </span>
      <div className="sr-body">
        <div className="sr-title">{title}</div>
        <div className="sr-msg">{msg}</div>
      </div>
      <button
        type="button"
        className="sr-x"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss banner"
      >
        <IcX />
      </button>
    </div>
  );
}

function contentFor(kind: ReplyContextErrorKind): {
  tone: 'warn' | 'danger';
  title: string;
  msg: React.ReactNode;
} {
  if (kind === 'truncated') {
    return {
      tone: 'warn',
      title: "Can’t pull in — this tweet is cut off",
      msg: (
        <>
          We only attach the full text. Click <strong>“Show more”</strong> on the post to expand it,
          then click it again.
        </>
      ),
    };
  }
  if (kind === 'media-only') {
    return {
      tone: 'danger',
      title: "Can’t pull in — nothing to read",
      msg: (
        <>
          This post is media only. Margin attaches text, so there’s nothing to pull into reply
          context.
        </>
      ),
    };
  }
  return {
    tone: 'danger',
    title: "Can’t pull in — couldn’t read that tweet",
    msg: <>X may have changed its markup. Try again, or refresh the page.</>,
  };
}
