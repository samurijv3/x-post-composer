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
  | { type: 'content:check-capture-mode' };

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
  | { type: 'bg:capture-mode-state'; active: boolean }
  | { type: 'bg:generation-result'; result: GenerationResult }
  | { type: 'bg:reply-context-result'; ok: boolean; context?: ReplyContext; message?: string }
  | { type: 'bg:error'; message: string };

/** Messages the background sends TO a content script via
 *  `chrome.tabs.sendMessage`. Separate from panel-bound replies. */
export type BackgroundToContent =
  | { type: 'bg:capture-mode-state'; active: boolean }
  | { type: 'bg:capture-reply-context-request' };

/**
 * One-way notifications the background broadcasts. Any open extension
 * surface (panel, options page) can listen via `onNotice`. Senders use
 * `broadcastNotice` and ignore the "no receiver" case so notices that
 * land while the panel is closed are silently dropped.
 */
export type BackgroundNotice =
  | { type: 'bg:library-changed' }
  | {
      type: 'bg:capture-notice';
      ok: boolean;
      message: string;
      itemId?: string;
    }
  // Fired by the keyboard shortcut. The panel switches to reply mode
  // and fires capture-reply-context on receipt. A timestamp lets stale
  // notices (panel that opens long after the shortcut) be ignored.
  | { type: 'bg:auto-reply-capture'; at: number };

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
    isMessageOfType(message, 'bg:capture-notice') ||
    isMessageOfType(message, 'bg:auto-reply-capture')
  );
}
