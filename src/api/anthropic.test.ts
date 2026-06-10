import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAnthropic, verifyKey, type MessagesCallRequest } from './anthropic';

/**
 * The client's deterministic logic — request-body shape, HTTP-status →
 * error-kind mapping, text-block extraction — pinned with a stubbed
 * global fetch. No network, no key. (This test file is the only
 * non-background importer of the module; the §6 boundary concerns
 * extension contexts, not tests.)
 */

function request(overrides: Partial<MessagesCallRequest> = {}): MessagesCallRequest {
  return {
    apiKey: 'sk-test-not-a-real-key',
    model: 'claude-haiku-4-5-20251001',
    prompt: 'hello',
    temperature: 0.7,
    maxTokens: 64,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubFetch(response: Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callAnthropic — request shape', () => {
  it('refuses an empty key locally without touching the network', async () => {
    const mock = stubFetch(jsonResponse(200, {}));
    const result = await callAnthropic(request({ apiKey: '' }));
    expect(result).toMatchObject({ ok: false, kind: 'auth' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends the key only in the x-api-key header, with version + browser-access headers', async () => {
    const mock = stubFetch(jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }));
    await callAnthropic(request());
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-not-a-real-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(init.body as string).not.toContain('sk-test-not-a-real-key');
  });

  it('sends a cache_control-tagged system array when system is provided', async () => {
    const mock = stubFetch(jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }));
    await callAnthropic(request({ system: 'be brief' }));
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.system).toEqual([
      { type: 'text', text: 'be brief', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('omits the system parameter entirely when system is empty', async () => {
    const mock = stubFetch(jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }));
    await callAnthropic(request({ system: '  ' }));
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('system');
  });
});

describe('callAnthropic — responses', () => {
  it('returns the first text block and the usage counts', async () => {
    stubFetch(
      jsonResponse(200, {
        content: [{ type: 'text', text: 'a draft' }],
        usage: { input_tokens: 12, output_tokens: 34 },
      }),
    );
    const result = await callAnthropic(request());
    expect(result).toEqual({
      ok: true,
      text: 'a draft',
      usage: { input_tokens: 12, output_tokens: 34 },
    });
  });

  it('skips non-text blocks (e.g. thinking) to find the text', async () => {
    stubFetch(
      jsonResponse(200, {
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: 'after' },
        ],
      }),
    );
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: true, text: 'after' });
  });

  it('treats a textless 200 as ok with empty text (caller decides)', async () => {
    stubFetch(jsonResponse(200, { content: [] }));
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: true, text: '' });
  });

  it('maps a body that fails to parse to an "other" error', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    } as unknown as Response);
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: false, kind: 'other' });
  });
});

describe('callAnthropic — HTTP error mapping', () => {
  const apiError = (message: string) => ({ error: { type: 'x', message } });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [400, 'bad-request'],
    [422, 'bad-request'],
    [500, 'server'],
    [503, 'server'],
    [418, 'other'],
  ] as const)('HTTP %i → kind "%s"', async (status, kind) => {
    stubFetch(jsonResponse(status, apiError('detail from anthropic')));
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: false, kind, status });
  });

  it('401 uses fixed wording and never echoes the key', async () => {
    stubFetch(jsonResponse(401, apiError('whatever the server said')));
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: false, message: 'Invalid API key.' });
    if (!result.ok) expect(result.message).not.toContain('sk-test');
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    stubFetch({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
    const result = await callAnthropic(request());
    expect(result).toMatchObject({
      ok: false,
      kind: 'server',
      message: expect.stringContaining('HTTP 503'),
    });
  });

  it('maps a thrown fetch (offline) to a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('socket hang up'))),
    );
    const result = await callAnthropic(request());
    expect(result).toMatchObject({ ok: false, kind: 'network' });
    if (!result.ok) expect(result.message).toContain('socket hang up');
  });
});

describe('verifyKey', () => {
  it('reports ok even when the probe returns no text (HTTP success is the signal)', async () => {
    stubFetch(jsonResponse(200, { content: [] }));
    expect(await verifyKey('sk-test-not-a-real-key', 'claude-haiku-4-5-20251001')).toEqual({
      ok: true,
    });
  });

  it('passes the mapped error message through', async () => {
    stubFetch(jsonResponse(401, { error: { type: 'authentication_error', message: 'nope' } }));
    expect(await verifyKey('sk-bad', 'claude-haiku-4-5-20251001')).toEqual({
      ok: false,
      message: 'Invalid API key.',
    });
  });
});
