/**
 * Single source of truth for the stored auth token.
 *
 * Previously the storage key was a magic string duplicated between AuthProvider
 * (which wrote it) and the API client (which read it). Both now go through here.
 *
 * Every access is guarded: `localStorage` throws on access in Safari private mode
 * and when site data is blocked, which would otherwise crash the app at startup.
 */

export const TOKEN_STORAGE_KEY = 'sahayak_token';

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

const PROFILE_STORAGE_KEY = 'sahayak_active_profile';

/** Which of this login's profiles acts (ADR-034): 'user' (owner) or 'partner'. */
export function getActiveProfile(): 'user' | 'partner' {
  try {
    return localStorage.getItem(PROFILE_STORAGE_KEY) === 'partner' ? 'partner' : 'user';
  } catch {
    return 'user';
  }
}

export function setActiveProfile(profile: 'user' | 'partner'): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, profile);
  } catch {
    // Storage unavailable: the owner profile acts by default.
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}
