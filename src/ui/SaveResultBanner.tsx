import { IcCheck, IcInfo, IcWarn, IcX } from './icons';

export type SaveResultKind =
  | 'success'
  | 'text-media'
  | 'duplicate'
  | 'not-mine'
  | 'truncated'
  | 'media-only';

export interface SaveResult {
  kind: SaveResultKind;
  rejectedAuthor?: string | undefined;
  duplicateOfId?: string | undefined;
  itemType?: 'post' | 'reply' | undefined;
  stamp: number;
}

interface BannerMeta {
  tone: 'ok' | 'warn' | 'info' | 'danger';
  autodismiss: boolean;
  iconKey: 'check' | 'warn' | 'info' | 'x';
}

export const SAVE_META: Record<SaveResultKind, BannerMeta> = {
  success: { tone: 'ok', autodismiss: true, iconKey: 'check' },
  'text-media': { tone: 'warn', autodismiss: true, iconKey: 'warn' },
  duplicate: { tone: 'info', autodismiss: true, iconKey: 'info' },
  'not-mine': { tone: 'danger', autodismiss: true, iconKey: 'x' },
  truncated: { tone: 'warn', autodismiss: true, iconKey: 'warn' },
  'media-only': { tone: 'danger', autodismiss: true, iconKey: 'x' },
};

interface Props {
  result: SaveResult;
  handle: string;
  onDismiss: () => void;
  onShowDup: (id: string) => void;
}

/**
 * The six-state save-result banner. Lives at the panel-shell level
 * (in App.tsx's sticky slot) so it floats at the top of the panel
 * viewport regardless of which screen is active or how far the user
 * has scrolled within a screen.
 */
export function SaveResultBanner({ result, handle, onDismiss, onShowDup }: Props) {
  const meta = SAVE_META[result.kind];
  let title: string;
  let msg: React.ReactNode;
  let action: { label: string; onClick: () => void } | null = null;

  if (result.kind === 'success') {
    title = 'Saved to your voice';
    msg = (
      <>
        Added as a <strong>{result.itemType ?? 'post'}</strong>.
      </>
    );
  } else if (result.kind === 'text-media') {
    title = 'Saved — text only';
    msg = (
      <>
        This post had media. We saved the <strong>text</strong>; images and quoted posts aren’t
        read.
      </>
    );
  } else if (result.kind === 'duplicate') {
    title = 'Already in your voice';
    msg = 'You saved this one before — no need to add it twice.';
    if (result.duplicateOfId) {
      const id = result.duplicateOfId;
      action = { label: 'Show me', onClick: () => onShowDup(id) };
    }
  } else if (result.kind === 'not-mine') {
    title = 'Not saved';
    msg = (
      <>
        That post is by <strong>@{result.rejectedAuthor ?? 'someone'}</strong>. Only your own posts
        {handle ? <> (@{handle})</> : null} can join your voice.
      </>
    );
  } else if (result.kind === 'media-only') {
    title = 'Not saved — nothing to read';
    msg = (
      <>This post is media only. Margin learns from text, so there’s nothing to add to your voice.</>
    );
  } else {
    title = 'Not saved — this tweet is cut off';
    msg = (
      <>
        We only save the full text. Click <strong>“Show more”</strong> on the post to expand it,
        then save it again.
      </>
    );
  }

  return (
    <div className={`save-result ${meta.tone}`} role="status" key={result.stamp}>
      <span className="sr-ic">
        {meta.iconKey === 'check' && <IcCheck />}
        {meta.iconKey === 'warn' && <IcWarn />}
        {meta.iconKey === 'info' && <IcInfo />}
        {meta.iconKey === 'x' && <IcX />}
      </span>
      <div className="sr-body">
        <div className="sr-title">{title}</div>
        <div className="sr-msg">{msg}</div>
        {action && (
          <button
            type="button"
            className="btn sm"
            onClick={action.onClick}
            style={{ marginTop: 8 }}
          >
            {action.label}
          </button>
        )}
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
      {meta.autodismiss && <span className="sr-progress" />}
    </div>
  );
}
