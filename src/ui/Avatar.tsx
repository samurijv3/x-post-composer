import { useState } from 'react';

interface AvatarProps {
  /** Full `pbs.twimg.com` URL. Null falls back to initials. */
  src: string | null;
  /** Display name or handle — used for initials fallback and alt text. */
  name: string | null;
  /** Pixel diameter. Defaults to 40px (X's standard avatar size). */
  size?: number;
}

/**
 * Circular avatar with graceful fallback. When `src` is null OR the
 * image fails to load (CDN hiccup, stale URL on a saved item), we
 * render the leading letters of the display name on a tinted disc.
 *
 * Network behaviour: this component is the only place in the codebase
 * that loads images from `pbs.twimg.com`. See CLAUDE.md §6 for the
 * inbound-image carve-out.
 */
export function Avatar({ src, name, size = 40 }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImg = src !== null && !failed;
  const initials = computeInitials(name);

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="avatar-init">{initials}</span>
      )}
    </div>
  );
}

function computeInitials(name: string | null): string {
  if (!name || name.trim() === '') return '·';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const initials = (first + last).toUpperCase();
  return initials === '' ? '·' : initials;
}
