/**
 * "Who am I, and where do I go next?" — the first call after a verified OTP.
 *
 * A verified Supabase session proves the caller controls a phone number and
 * nothing more. It does not say whether Sahayak has a profile for that account,
 * which of the three kinds it is, or what our local id for it is — and the app
 * cannot route without all three. `GET /api/v1/auth/me` answers it.
 *
 * The three outcomes are a union rather than a nullable profile because they lead
 * to three different screens, and collapsing any two of them strands a real user:
 *
 *   registered        → straight into the app, by role
 *   needs-signup      → the profile form; the token is valid, there is just no
 *                       profile behind it yet
 *   needs-linking     → an unclaimed profile exists for this number. Ops
 *                       registered this mechanic before they ever opened the
 *                       app, and the two records have to be bound together.
 *
 * The backend distinguishes the last two with separate error codes precisely so a
 * client can tell them apart (ADR-011): `USER_NOT_REGISTERED` and
 * `IDENTITY_NOT_LINKED` are both 403, and a client that reads only the status
 * sends a brand-new owner to a "contact support" dead end and an ops-registered
 * mechanic round a signup form that will reject their phone number as taken.
 */
import { ApiError, apiClient } from './api';

export type BackendRole = 'user' | 'partner' | 'admin';

export interface IdentityPayload {
  role: BackendRole;
  id: string;
}

export type IdentityResolution =
  | { kind: 'registered'; identity: IdentityPayload }
  | { kind: 'needs-signup' }
  | { kind: 'needs-linking' }
  /** Network failure, 500, or a 401 the token refresh could not fix. */
  | { kind: 'error'; message: string; code?: string };

export const identityService = {
  /**
   * Resolve the stored bearer token to a local profile.
   *
   * Never throws: every caller is a routing decision, and a thrown error there
   * becomes a blank screen rather than a redirect.
   */
  async resolve(): Promise<IdentityResolution> {
    try {
      const res = await apiClient<IdentityPayload>('/auth/me', { method: 'GET' });
      return { kind: 'registered', identity: res.data };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'USER_NOT_REGISTERED') return { kind: 'needs-signup' };
        if (err.code === 'IDENTITY_NOT_LINKED') return { kind: 'needs-linking' };
        return { kind: 'error', message: err.message, code: err.code };
      }
      return { kind: 'error', message: (err as Error).message };
    }
  },
};

/** Where a resolved identity belongs in this app's route tree. */
export function homeRouteForRole(role: BackendRole): string {
  switch (role) {
    case 'partner':
      return '/partner/dashboard';
    case 'admin':
      return '/admin/overview';
    case 'user':
    default:
      return '/owner';
  }
}
