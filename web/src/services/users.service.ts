import { apiClient } from './api';
import { UserRegistrationResponse, CreateUserPayload } from '../types/users';

export const usersService = {
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
