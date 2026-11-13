import { apiClient } from './api';
import { UserRegistrationResponse, CreateUserPayload } from '../types/users';

/** GET/PATCH /users/me (G8). */
export interface OwnerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  created_at: string;
}

export const usersService = {
  async getMe(): Promise<OwnerProfile> {
    return (await apiClient<OwnerProfile>('/users/me', { method: 'GET' })).data;
  },

  /** Send email: null to clear it. 400 USER_ALREADY_EXISTS if the email is taken. */
  async updateMe(body: { name?: string; email?: string | null }): Promise<OwnerProfile> {
    return (await apiClient<OwnerProfile>('/users/me', { method: 'PATCH', body: JSON.stringify(body) })).data;
  },

  /** Everything Sahayak stores about the owner (G10). */
  async exportMe(): Promise<Record<string, unknown>> {
    return (await apiClient<Record<string, unknown>>('/users/me/export', { method: 'GET' })).data;
  },

  /** ADR-025. 409 ACCOUNT_HAS_ACTIVE_JOB while a request is live. Irreversible. */
  async deleteMe(): Promise<void> {
    await apiClient<{ deleted: boolean }>('/users/me', { method: 'DELETE' });
  },

  /**
   * Registers the caller as a vehicle owner via POST /api/v1/users.
   *
   * Authenticated: the backend creates the profile *and* binds it to the
   * Supabase account the bearer token belongs to, in one transaction. So the
   * caller must already hold a verified token — there is nothing to store
   * afterwards and no token in the response to look for. This used to read
   * `res.data.token || res.data.access_token` and store it; neither field has
   * ever existed, because the backend verifies Supabase tokens and never issues
   * its own.
   *
   * `phone` is recorded as given, but `phone_verified` comes from the token's
   * phone claim rather than this field — so a number that differs from the one
   * that passed OTP lands unverified.
   */
  async createUser(payload: CreateUserPayload): Promise<UserRegistrationResponse> {
    const res = await apiClient<UserRegistrationResponse>('/users', {
      method: 'POST',
      body: JSON.stringify({
        role: 'owner',
        name: payload.name,
        phone: payload.phone,
        ...(payload.email ? { email: payload.email } : {}),
      }),
    });

    return res.data;
  },
};

// Removed 2026-10-06: getUser(userId) called GET /api/v1/users/{id}, which has
// never existed — the backend exposes no per-user read. What its callers actually
// wanted was "who am I", and that is identityService.resolve() against
// GET /api/v1/auth/me.
