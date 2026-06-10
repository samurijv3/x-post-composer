/**
 * Format an ISO 8601 timestamp the way x.com does in tweet headers.
 *
 * Rules (matched against current x.com behaviour, June 2026):
 *   < 60s            → "now"
 *   < 60m            → "{n}m"
 *   < 24h            → "{n}h"
 *   same calendar yr → "{Mon} {d}"        e.g. "Apr 5"
 *   different year   → "{Mon} {d}, {yyyy}" e.g. "Apr 5, 2024"
 *
 * `now` is injectable for deterministic tests; production callers pass
 * `Date.now()`.
 *
 * Returns `null` when the timestamp can't be parsed — the UI layer can
 * then hide the time chip rather than show "Invalid Date".
 */
export function formatRelativeTweetTime(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;

  const seconds = Math.max(0, Math.floor((now - t) / 1000));
  if (seconds < 60) return 'now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;

  const tweetDate = new Date(t);
  const nowDate = new Date(now);
  const month = MONTHS[tweetDate.getMonth()] ?? '';
  const day = String(tweetDate.getDate());
  if (tweetDate.getFullYear() === nowDate.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${String(tweetDate.getFullYear())}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
