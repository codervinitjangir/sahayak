/**
 * Single source of truth for the stored auth token.
 *
 * Previously the storage key was a magic string duplicated between AuthProvider
 * (which wrote it) and the API client (which read it). Both now go through here.
 *
 * Every access is guarded: `localStorage` throws on access in Safari private mode
 * and when site data is blocked, which would otherwise crash the app at startup.
 */

const TOKEN_STORAGE_KEY = 'sahayak_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable — the session simply will not persist across reloads.
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}
