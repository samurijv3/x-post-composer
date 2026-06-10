/**
 * The raw payload the content script sends to the background after it
 * extracts a tweet from X's DOM. The background validates and converts
 * this into a `LibraryItem` — content code never touches the corpus.
 *
 * Every field is "best effort": the content script reads from the most
 * stable DOM hooks it can find but X's markup is a moving target. When
 * a load-bearing field cannot be read, the content script sends a
 * `content:capture-failed` message with a `CaptureFailureReason`
 * instead of guessing.
 */
export interface RawCapture {
  /** Tweet body text exactly as rendered. */
  text: string;
  /** Author handle without the leading `@`. */
  authorHandle: string;
  /** Author display name as rendered by X. Null when the name node can't be located. */
  authorDisplayName: string | null;
  /** Full URL to the author's avatar on `pbs.twimg.com`. Null when not found.
   *  Loaded directly as `<img src>` in the panel — see CLAUDE.md §6. */
  authorAvatarUrl: string | null;
  /** Permalink-derived id when found. Used as the LibraryItem id if present. */
  statusId: string | null;
  /** ISO 8601 timestamp from the `<time>` element when present. */
  timestamp: string | null;
  /** Whether X showed a "Replying to @..." marker on this tweet. */
  hasReplyContextNode: boolean;
  /** Parent status id when X exposes it (status detail page). */
  inReplyToStatusId: string | null;
  /** True only on `/{handle}/status/{id}` pages, when the captured
   *  article renders below another tweet article (the parent). On feed
   *  views this is always false so it cannot mis-tag posts with sibling
   *  posts above them. */
  isPrecededByParentArticle: boolean;
  /** True when the article contains media (images, video, link card,
   *  quoted tweet). Used to surface the "saved text only" notice on
   *  captures of mixed-content tweets. */
  hasMedia: boolean;
}

/**
 * Reasons the content script could not extract a tweet. The panel
 * surfaces these as plain-language messages plus the manual-paste path.
 */
export type CaptureFailureReason =
  | 'no-tweet-under-cursor'
  | 'missing-text'
  | 'missing-author'
  | 'truncated'
  | 'media-only'
  | 'unknown';
