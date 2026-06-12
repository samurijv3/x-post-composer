import { IcCheck, IcInfo, IcWarn, IcX } from './icons';

export type SaveResultKind =
  | 'success'
  | 'text-media'
  | 'duplicate'
  | 'not-mine'
  | 'truncated'
  | 'media-only'
  | 'unreadable';

export interface SaveResult {
  kind: SaveResultKind;
  rejectedAuthor?: string | undefined;
  duplicateOfId?: string | undefined;
  /** The matched record's pre-merge source — decides the duplicate
   *  wording (a shipped match is a promotion, not a re-save). */
  duplicateOfSource?: 'manual' | 'shipped' | 'archive' | undefined;
  /** 'thread' only on manual thread pastes (exact count, no
   *  scroll-into-view caveat); captured threads carry only the count. */
  itemType?: 'post' | 'reply' | 'thread' | undefined;
  /** Present on thread captures — the honest rendered-segment count. */
  threadSegmentCount?: number | undefined;
  /** Thread truncation failures: WHICH posts are collapsed (1-based). */
  truncatedOrdinals?: number[] | undefined;
  /** Set when a capture-mode bundle target filed the saved item — the
   *  banner states the side effect; it is never silent. */
  filedIntoBundleName?: string | undefined;
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
  unreadable: { tone: 'danger', autodismiss: true, iconKey: 'x' },
};

interface Props {
  result: SaveResult;
  handle: string;
  onDismiss: () => void;
  onShowDup: (id: string) => void;
}

/**
 * The save-result banner (one branch per SaveResultKind). Lives at the
 * panel-shell level (in App.tsx's sticky slot) so it floats at the top
 * of the panel viewport regardless of which screen is active or how
 * far the user has scrolled within a screen.
 */
export function SaveResultBanner({ result, handle, onDismiss, onShowDup }: Props) {
  const meta = SAVE_META[result.kind];
  let title: string;
  let msg: React.ReactNode;
  let action: { label: string; onClick: () => void } | null = null;

  // Capture-with-a-bundle-target appends "filed into …" so the side
  // effect is visible on whichever save outcome carried it.
  const filed = result.filedIntoBundleName ? (
    <>
      {' '}
      Filed into <strong>“{result.filedIntoBundleName}”</strong>.
    </>
  ) : null;

  if (result.kind === 'success') {
    title = 'Saved to your voice';
    // A pasted thread's count is exact; the scroll-into-view caveat
    // only applies to captures, where virtualization bounds the count.
    msg =
      result.itemType === 'thread' && result.threadSegmentCount ? (
        <>
          Added as a <strong>thread · {result.threadSegmentCount} posts</strong>.{filed}
        </>
      ) : result.threadSegmentCount ? (
        <>
          Saved as a <strong>thread · {result.threadSegmentCount} posts</strong> (every post visible
          on screen — scroll a long thread fully into view before capturing).{filed}
        </>
      ) : (
        <>
          Added as a <strong>{result.itemType ?? 'post'}</strong>.{filed}
        </>
      );
  } else if (result.kind === 'text-media') {
    title = 'Saved — text only';
    msg = (
      <>
        This post had media. We saved the <strong>text</strong>; images and quoted posts aren’t
        read.{filed}
      </>
    );
  } else if (result.kind === 'duplicate') {
    title = 'Already in your voice';
    // What "already" actually means depends on how the match got
    // there: a shipped row wasn't saved BY the user — the loop saved
    // it — and this handpick promotes it. Say that, don't scold.
    const story =
      result.duplicateOfSource === 'shipped' ? (
        <>This matches a draft you shipped from Margin — it’s now marked as a handpicked example.</>
      ) : result.duplicateOfSource === 'archive' ? (
        <>This was in your archive import — your handpick promotes it to a curated example.</>
      ) : (
        <>You saved this one before — no second copy.</>
      );
    msg = (
      <>
        {story}
        {filed}
      </>
    );
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
      <>
        This post is media only. Margin learns from text, so there’s nothing to add to your voice.
      </>
    );
  } else if (result.kind === 'unreadable') {
    title = 'Not saved — couldn’t read that tweet';
    msg = (
      <>
        X may have changed its markup. Try again after a refresh, or paste the text in with{' '}
        <strong>Add manually</strong> on the Voice screen.
      </>
    );
  } else if (result.truncatedOrdinals && result.truncatedOrdinals.length > 0) {
    const ordinals = result.truncatedOrdinals;
    title = 'Not saved — part of this thread is cut off';
    msg = (
      <>
        {ordinals.length === 1 ? 'Post' : 'Posts'} <strong>{ordinals.join(', ')}</strong>{' '}
        {ordinals.length === 1 ? 'is' : 'are'} collapsed. Click <strong>“Show more”</strong> on{' '}
        {ordinals.length === 1 ? 'it' : 'each'}, then capture the thread again — we only save the
        full text.
      </>
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
