/**
 * The one definition of "this URL is an X page". The background's tab
 * watcher uses it to tell the panel whether the active tab is on X;
 * the match-pattern twin (`X_HOSTS` in entrypoints/background/tabs.ts)
 * must stay in sync — same four hosts, https only.
 */
const X_HOSTNAMES = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

/**
 * True iff the URL is an https x.com / twitter.com page. Undefined and
 * unparseable input return false — chrome.tabs omits `url` entirely for
 * hosts outside the extension's host permissions, so "we can't see the
 * URL" and "not on X" are deliberately the same answer.
 */
export function isXPageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && X_HOSTNAMES.has(parsed.hostname);
}
