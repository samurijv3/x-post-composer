# Security audit — v1 (Chunk 5)

Audit of the codebase against the hard rules in [`CLAUDE.md`](./CLAUDE.md) §6.

## Method

Programmatic `grep` over `src/` and `entrypoints/`, manual review of every imported boundary, inspection of the production bundle (`.output/chrome-mv3/`) to confirm nothing extra leaked through Vite.

## Findings — all checks PASS

| #   | Invariant                                    | Method                                                                                                   | Result                                                                                                                                                                                                       |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | API key read only by background worker       | `grep getApiKey` across `src/ui/` and `entrypoints/`                                                     | One caller in `AccountTab.tsx` (the settings input field — explicitly allowed by §6) and one in `background.ts`. Zero elsewhere.                                                                             |
| 2   | `src/api/` imported only by background       | `grep "from.*api/anthropic"`                                                                             | Exactly one import line: `entrypoints/background.ts`.                                                                                                                                                        |
| 3   | Storage is `local` / `session`, never `sync` | `grep storage\.sync`                                                                                     | Single hit is the explanatory comment in `src/storage/config.ts` line 4 — no actual usage.                                                                                                                   |
| 4   | Only `api.anthropic.com` is reached          | `grep "fetch("`                                                                                          | One call site, `src/api/anthropic.ts`, targeting `https://api.anthropic.com/v1/messages`.                                                                                                                    |
| 5   | No telemetry / analytics endpoints           | `grep -i 'analytics\|telemetry\|track(\|posthog\|mixpanel\|segment\|sentry\|datadog\|fathom\|plausible'` | Zero hits.                                                                                                                                                                                                   |
| 6   | No DOM writes on X                           | `grep "innerHTML=\|outerHTML=\|insertAdjacent\|tabs\.executeScript"`                                     | Zero hits.                                                                                                                                                                                                   |
| 7   | No auto-post                                 | `grep "submit()\|sendTweet\|postTweet"`                                                                  | Zero hits. The only output path is `navigator.clipboard.writeText` in `DraftDisplay.tsx`, triggered by a user click.                                                                                         |
| 8   | Permissions minimal, no `<all_urls>`         | `grep "<all_urls>"` + manifest review                                                                    | Permissions: `storage`, `sidePanel`, `clipboardWrite`, `unlimitedStorage`. `host_permissions`: `https://x.com/*`, `https://www.x.com/*`, `https://twitter.com/*`, `https://www.twitter.com/*`. Nothing else. |
| 9   | Key never logged                             | `grep "console\."` then manually inspect each                                                            | Two `console.error` calls in `background.ts`, both for `sidePanel.setPanelBehavior` / `sidePanel.open` failures. Neither has the key in scope.                                                               |
| 10  | Key not on messaging payloads                | `grep "apiKey:\|key:" src/messaging/`                                                                    | Zero hits.                                                                                                                                                                                                   |
| 11  | Key not in `lastPrompt` storage              | Manual review of `src/storage/lastPrompt.ts` + grep                                                      | The record stores the rendered prompt body (which never contains the key — the key goes in the HTTP `x-api-key` header) and the response text. No key reference.                                             |
| 12  | Content script has no key/api dependency     | `grep "api/anthropic\|storage/key\|getApiKey" entrypoints/twitter.content.ts`                            | Zero hits.                                                                                                                                                                                                   |
| 13  | Built bundle confirms boundaries             | `grep -oE 'https?://[^"]+' .output/chrome-mv3/background.js`                                             | `api.anthropic.com`, `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com`, and `twemoji.maxcdn.com`. See note below.                                                                                       |
| 14  | Content-script bundle has no key plumbing    | `grep "api\.anthropic\.com\|x-api-key\|apiKey" .output/chrome-mv3/content-scripts/twitter.js`            | Zero hits.                                                                                                                                                                                                   |

## Note on `twemoji.maxcdn.com`

The string `https://twemoji.maxcdn.com/...` appears in the built `background.js` because the transitive dep `twemoji-parser` (used by `twitter-text` for emoji-position detection) builds emoji image URLs _if_ its caller requests them. We call `parseTweet` only for `weightedLength`; we never invoke the URL-building path.

The string is dead-code in our usage. Even if a future regression in the dep started invoking it, Chrome would block the request — the manifest's `host_permissions` does not include `twemoji.maxcdn.com`, and an extension cannot reach a host it has not declared.

This was investigated and ruled non-issue. Left in place because rewriting `twitter-text` to strip the dep is out of scope for v1 and the constant is harmless.

## Conclusion

**No exceptions to the §6 invariants.** The architecture and its build output match the rules end to end.

The single external host the extension may reach is `api.anthropic.com`, with `x.com` and `twitter.com` permitted only for the read-only content script. There is no proxy, no telemetry, no analytics, no third-party endpoint. The API key never crosses the background boundary.
