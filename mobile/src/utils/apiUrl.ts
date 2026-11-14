/**
 * Normalise an API base URL so it always ends in /api/v1.
 *
 * Found 2026-11-14 in a live run: mobile/.env carried a bare host
 * (http://192.168.1.55:8010), so every call went to /auth/me and 404ed, and the
 * login screen showed a bare "Not Found". The service modules call paths
 * relative to /api/v1, so the prefix is part of the contract; one developer's
 * env file should not be able to break every request.
 */
export function withApiPrefix(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}
