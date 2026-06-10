/**
 * Anthropic API client. THIS MODULE IS IMPORTED ONLY BY THE BACKGROUND
 * SERVICE WORKER. Importing it from a content script or from panel UI
 * would put the API key on the wrong side of the trust boundary — see
 * CLAUDE.md §6.
 *
 * Why a hand-rolled fetch instead of `@anthropic-ai/sdk`: this repo is
 * public and the user is trusting it with their key. A short file that
 * anyone can read in one sitting is more honest than dragging in a
 * large SDK whose surface (credential chains, agent toolset, file
 * uploads) we do not use. The single externally reachable host is
 * `api.anthropic.com`, exactly as CLAUDE.md §6 promises.
 *
 * Browser-origin opt-in: `anthropic-dangerous-direct-browser-access:
 * true` acknowledges that the key lives in a browser-reachable context
 * (the user's own machine, in our case the extension's service
 * worker). Without that header Anthropic rejects browser-shaped
 * requests.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface MessagesCallRequest {
  apiKey: string;
  model: string;
  /** Body of the user message. */
  prompt: string;
  /** Optional system message. When non-empty, sent as the `system`
   *  parameter with `cache_control: { type: "ephemeral" }` so the
   *  stable framing (voice guide, exclusions, char rules) gets cached
   *  by Anthropic for ~5 minutes — reused-call cost drops to ~10%. */
  system?: string;
  temperature: number;
  maxTokens: number;
}

export interface MessagesCallSuccess {
  ok: true;
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Distinct kinds the UI surfaces with distinct messages. */
export type CallErrorKind = 'auth' | 'rate-limit' | 'network' | 'server' | 'bad-request' | 'other';

export interface MessagesCallError {
  ok: false;
  kind: CallErrorKind;
  message: string;
  status?: number;
}

export type MessagesCallResult = MessagesCallSuccess | MessagesCallError;

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicErrorBody {
  error?: { type?: string; message?: string };
}

/**
 * POST to the Messages endpoint. Returns a discriminated result so the
 * caller never has to throw/catch. Never logs the key, never echoes it
 * in errors, never includes it in the returned shape.
 */
export async function callAnthropic(req: MessagesCallRequest): Promise<MessagesCallResult> {
  if (req.apiKey === '') {
    return { ok: false, kind: 'auth', message: 'No API key set. Add one in the Account tab.' };
  }

  let response: Response;
  try {
    // Build the request body. When `system` is non-empty, pass it as
    // an array with `cache_control` so Anthropic caches the system
    // tokens for ~5 minutes — re-used initial-generation prompts get
    // a ~90% discount on the cached portion. Refine/repair calls
    // (which omit system) skip caching entirely.
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [{ role: 'user', content: req.prompt }],
    };
    if (req.system && req.system.trim() !== '') {
      body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
    }
    response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      message: `Could not reach Anthropic: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  if (!response.ok) {
    let detail = `HTTP ${String(response.status)}`;
    try {
      const body = (await response.json()) as AnthropicErrorBody;
      if (body.error?.message) detail = body.error.message;
    } catch {
      // Body wasn't JSON. Fall back to status text.
    }
    return mapHttpError(response.status, detail);
  }

  let body: AnthropicResponse;
  try {
    body = (await response.json()) as AnthropicResponse;
  } catch (error) {
    return {
      ok: false,
      kind: 'other',
      message: `Could not parse Anthropic response: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }

  // Return whatever text the response carried — empty string if there
  // was no text block. The HTTP call itself succeeded; whether empty
  // text is a problem is a question for the caller. (For verifyKey it
  // isn't — auth worked. For generation it is — we re-check downstream.)
  return {
    ok: true,
    text: extractFirstTextBlock(body),
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
    },
  };
}

function mapHttpError(status: number, detail: string): MessagesCallError {
  if (status === 401) return { ok: false, kind: 'auth', status, message: 'Invalid API key.' };
  if (status === 403) {
    return { ok: false, kind: 'auth', status, message: `API key was rejected: ${detail}` };
  }
  if (status === 429) {
    return {
      ok: false,
      kind: 'rate-limit',
      status,
      message: `Rate limit hit. Wait a moment and try again. (${detail})`,
    };
  }
  if (status === 400 || status === 422) {
    return {
      ok: false,
      kind: 'bad-request',
      status,
      message: `Anthropic rejected the request: ${detail}`,
    };
  }
  if (status >= 500) {
    return { ok: false, kind: 'server', status, message: `Anthropic server error: ${detail}` };
  }
  return { ok: false, kind: 'other', status, message: detail };
}

function extractFirstTextBlock(body: AnthropicResponse): string {
  for (const block of body.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

/**
 * "Does this key work" probe used by the Account tab. Routes through
 * the same `callAnthropic` so the user gets the same error wording for
 * auth / rate-limit / network failures. We bump `max_tokens` to 8 so
 * the model has actual headroom to emit content — a `max_tokens: 1`
 * request can come back with `stop_reason: max_tokens` before any
 * text block lands in `content`, which is a successful HTTP call but
 * empty text. For verify we only care that the HTTP call succeeded.
 */
export async function verifyKey(
  apiKey: string,
  model: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await callAnthropic({
    apiKey,
    model,
    prompt: 'ping',
    temperature: 0,
    maxTokens: 8,
  });
  if (result.ok) return { ok: true };
  return { ok: false, message: result.message };
}
