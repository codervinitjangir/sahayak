import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError, createIdempotencyKey, UNAUTHORIZED_EVENT } from '../../src/services/api';
import { getAuthToken, setAuthToken } from '../../src/services/authToken';

/** Builds a Response-alike with just the surface apiClient touches. */
function mockResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 500 ? 'Internal Server Error' : '',
    text: () => Promise.resolve(body),
  } as Response;
}

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('returns the parsed envelope on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(200, JSON.stringify({ data: { id: 'job-1' }, meta: { request_id: 'req-1' } }))
    );

    const result = await apiClient<{ id: string }>('/jobs/job-1');

    expect(result.data).toEqual({ id: 'job-1' });
    expect(result.meta?.request_id).toBe('req-1');
  });

  it('parses the error envelope into an ApiError carrying code, status and request_id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(
        422,
        JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: 'vehicle_id is not a known vehicle' },
          request_id: 'req-abc',
        })
      )
    );

    const err = await apiClient('/jobs', { method: 'POST' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.status).toBe(422);
    expect(apiError.requestId).toBe('req-abc');
    expect(apiError.message).toBe('vehicle_id is not a known vehicle');
  });

  it('falls back to an HTTP_<status> code when the error body has no envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(500, JSON.stringify({ oops: true })));

    const err = (await apiClient('/jobs').catch((e: unknown) => e)) as ApiError;

    expect(err.code).toBe('HTTP_500');
    expect(err.status).toBe(500);
  });

  it('raises PARSE_ERROR when the body is not JSON (e.g. an HTML error page)', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(502, '<html>Bad Gateway</html>'));

    const err = (await apiClient('/jobs').catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('PARSE_ERROR');
  });

  it('sends the Idempotency-Key header only when a key is supplied', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, JSON.stringify({ data: {} })));

    await apiClient('/jobs', { method: 'POST', idempotencyKey: 'key-123' });
    const withKey = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((withKey.headers as Record<string, string>)['Idempotency-Key']).toBe('key-123');

    await apiClient('/jobs');
    const withoutKey = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    expect(withoutKey.headers as Record<string, string>).not.toHaveProperty('Idempotency-Key');
  });

  it('attaches a bearer header only when a token is stored', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, JSON.stringify({ data: {} })));

    await apiClient('/jobs');
    const anonymous = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(anonymous.headers as Record<string, string>).not.toHaveProperty('Authorization');

    setAuthToken('real-token');
    await apiClient('/jobs');
    const authed = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    expect((authed.headers as Record<string, string>)['Authorization']).toBe('Bearer real-token');
  });

  it('clears the stored token and announces UNAUTHORIZED_EVENT on a 401', async () => {
    setAuthToken('stale-token');
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(401, JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }))
    );

    const onUnauthorized = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    await expect(apiClient('/jobs')).rejects.toBeInstanceOf(ApiError);

    expect(getAuthToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  });

  it('leaves the token in place for non-401 failures', async () => {
    setAuthToken('good-token');
    vi.mocked(fetch).mockResolvedValue(
      mockResponse(403, JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your job' } }))
    );

    await expect(apiClient('/jobs')).rejects.toBeInstanceOf(ApiError);

    expect(getAuthToken()).toBe('good-token');
  });
});

describe('createIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a distinct UUID v4 on each call', () => {
    const a = createIdempotencyKey();
    const b = createIdempotencyKey();

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });

  it('still produces a valid v4 without crypto.randomUUID (plain-http LAN testing)', () => {
    // randomUUID is secure-context only, so it is missing over http://<LAN-IP>.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    const key = createIdempotencyKey();

    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
