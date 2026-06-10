/**
 * Typed message contracts between the side panel, background service
 * worker, and content scripts.
 *
 * Conventions:
 *   - Every message carries a `type` discriminator and the union below
 *     is the single source of truth.
 *   - Names are prefixed with the sender role so route handlers stay
 *     readable: `panel:`, `content:`, `bg:`.
 *   - Messages split into two kinds:
 *       Requests (PanelToBackground, ContentToBackground) get a reply.
 *       Notices  (BackgroundNotice)                       are broadcast.
 */
import type { RawCapture, CaptureFailureReason } from '../types/capture';
import type {
  GenerationRequest,
  GenerationResult,
  RefineRequest,
  ReplyContext,
} from '../types/generation';
import type { ActiveCaptureMode } from '../storage/captureMode';

/** Requests the side panel sends to the background worker. */
export type PanelToBackground =
  | { type: 'panel:ping' }
  | { type: 'panel:verify-key' }
  // Save a manually-pasted item. Bypasses validateAuthor because the
  // user explicitly confirmed authorship in the form.
  | {
      type: 'panel:add-manual-item';
      text: string;
      itemType: 'post' | 'reply';
    }
  // Ask the background to run the full generation pipeline (sample →
  // assemble → call → autoFix → check → optional repair → optional
  // tighten). The `isRegenerate` flag on the request bumps temperature.
  | { type: 'panel:generate'; request: GenerationRequest }
  // Refine an existing draft via a chip or a more/less debounced fire.
  // Same post-pipeline as generate (autoFix → repair → tighten) but
  // does NOT touch the example pool.
  | { type: 'panel:refine'; request: RefineRequest }
  // Ask the background to coordinate a reply-context capture from the
  // active x.com tab's open composer.
  | { type: 'panel:capture-reply-context' };

/** Requests a content script sends to the background worker. */
export type ContentToBackground =
  | { type: 'content:captured-tweet'; payload: RawCapture }
  | { type: 'content:capture-failed'; reason: CaptureFailureReason }
  // Initial read on content-script load. Content scripts cannot reach
  // `chrome.storage.session` directly (kept trusted-only so the user's
  // "Session only" API-key choice keeps its isolation), so they ask the
  // background for the current capture-mode value instead.
  | { type: 'content:check-capture-mode' }
  // Sister request to the above — fetch the current reply-context lock
  // on content-script load so the overlay can re-paint without waiting
  // for a state push.
  | { type: 'content:check-reply-context-lock' }
  // Initial fetch of panel-open state on content-script load so we
  // don't have to wait for the first port event.
  | { type: 'content:check-panel-state' }
  // Fired when the user clicks a tweet in reply-context mode. The
  // background persists the lock and broadcasts it back. The mode
  // deliberately stays ON so the user can click another tweet to swap
  // the lock; they turn it off in the panel when done.
  | { type: 'content:reply-context-selected'; context: ReplyContext }
  // Reply-context selection failed (truncated tweet, media-only, etc).
  // Routed separately from library-capture failures so the panel can
  // show reply-context-appropriate wording rather than a save-to-voice
  // banner.
  | { type: 'content:reply-context-failed'; reason: CaptureFailureReason }
  // Fired by the overlay's dismiss control (the X button).
  | { type: 'content:dismiss-reply-context' };

/** Replies the background returns to a request. */
export type BackgroundReply =
  | { type: 'bg:pong'; receivedAt: number }
  | { type: 'bg:verify-key-result'; ok: boolean; message: string }
  | { type: 'bg:add-manual-result'; ok: boolean; message: string; itemId?: string }
  | { type: 'bg:capture-ack'; ok: boolean }
  // Reply to `content:check-capture-mode` AND the shape the background
  // proactively pushes to each content script when the panel flips
  // capture mode. Same shape on purpose — content's handler treats both
  // arrival paths identically.
  | { type: 'bg:capture-mode-state'; mode: ActiveCaptureMode }
  // Reply to `content:check-reply-context-lock` AND the push from
  // background when the lock changes (set / cleared).
  | { type: 'bg:reply-context-lock-state'; lock: ReplyContext | null }
  // Reply to `content:check-panel-state`. Same shape the background
  // pushes to content via tabs.sendMessage when ports open/close.
  | { type: 'bg:panel-state'; isOpen: boolean }
  | { type: 'bg:generation-result'; result: GenerationResult }
  | { type: 'bg:reply-context-result'; ok: boolean; context?: ReplyContext; message?: string }
  | { type: 'bg:error'; message: string };

/** Messages the background sends TO a content script via
 *  `chrome.tabs.sendMessage`. Separate from panel-bound replies. */
export type BackgroundToContent =
  | { type: 'bg:capture-mode-state'; mode: ActiveCaptureMode }
  | { type: 'bg:reply-context-lock-state'; lock: ReplyContext | null }
  // Pushed whenever the count of open side-panel ports goes 0↔n. The
  // content script suppresses all visual overlays when isOpen is false
  // so x.com stays untouched whenever the user has the panel closed.
  | { type: 'bg:panel-state'; isOpen: boolean }
  | { type: 'bg:capture-reply-context-request' };

/**
 * One-way notifications the background broadcasts. Any open extension
 * surface (panel, options page) can listen via `onNotice`. Senders use
 * `broadcastNotice` and ignore the "no receiver" case so notices that
 * land while the panel is closed are silently dropped.
 */
export type BackgroundNotice =
  | { type: 'bg:library-changed' }
  // Fired by the keyboard shortcut for a panel that is ALREADY open
  // (a panel the shortcut just opened consumes the session flag on
  // mount instead). The timestamp matches the flag's so the panel can
  // dedupe the pair.
  | { type: 'bg:auto-reply-capture'; at: number }
  // Result of a capture attempt, with enough detail for the floating
  // save-result banner to show the right message.
  | {
      type: 'bg:save-result';
      kind:
        | 'success'
        | 'text-media'
        | 'duplicate'
        | 'not-mine'
        | 'truncated'
        | 'media-only'
        | 'unreadable';
      itemId?: string;
      itemType?: 'post' | 'reply';
      rejectedAuthor?: string;
      duplicateOfId?: string;
    }
  // Reply-context-mode selection failure. Mirrors `bg:save-result` —
  // we send the *kind* and let the panel render reply-context-flavoured
  // wording in the same .save-result banner chrome as save failures.
  | {
      type: 'bg:reply-context-error';
      kind: 'truncated' | 'media-only' | 'unknown';
    };

/** Every message shape that flows through `chrome.runtime`. */
export type AnyMessage =
  | PanelToBackground
  | ContentToBackground
  | BackgroundReply
  | BackgroundNotice;

/** Type guard narrowing by `type`. */
export function isMessageOfType<T extends AnyMessage['type']>(
  message: unknown,
  type: T,
): message is Extract<AnyMessage, { type: T }> {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type: unknown }).type === type
  );
}

/** True for any background notice shape. */
export function isBackgroundNotice(message: unknown): message is BackgroundNotice {
  return (
    isMessageOfType(message, 'bg:library-changed') ||
    isMessageOfType(message, 'bg:auto-reply-capture') ||
    isMessageOfType(message, 'bg:save-result') ||
    isMessageOfType(message, 'bg:reply-context-error')
  );
}
