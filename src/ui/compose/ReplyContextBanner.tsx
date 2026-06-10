interface ReplyContextBannerProps {
  on: boolean;
  /** Slimmer layout for the in-draft brief card. Drops the help paragraph. */
  compact?: boolean;
  onToggle: () => void;
}

/**
 * Reply-context-mode banner. Mirrors the save-to-voice `CaptureBanner`
 * in the Voice screen so the two "mode is ON" indicators read as
 * siblings — same green tint, same pulsing dot, same switch — only the
 * wording differs.
 */
export function ReplyContextBanner({ on, compact = false, onToggle }: ReplyContextBannerProps) {
  return (
    <div className={`capture-banner ${on ? 'on' : ''} ${compact ? 'compact' : ''}`}>
      <div className="cb-top">
        <span className="cb-dot" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {on ? 'Reply-context mode: ON' : 'Reply to a tweet'}
          </div>
          {!compact && (
            <p className="help" style={{ marginTop: 1 }}>
              {on
                ? 'Pick the tweet you want to reply to on x.com.'
                : 'Pull in the post you’re replying to.'}
            </p>
          )}
        </div>
        <label
          className="switch"
          title={on ? 'Turn off reply-context mode' : 'Turn on reply-context mode'}
        >
          <input type="checkbox" checked={on} onChange={onToggle} />
          <span className="track track-ok" />
        </label>
      </div>
    </div>
  );
}
