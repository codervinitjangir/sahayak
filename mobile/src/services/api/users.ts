import { apiClient } from "./client";

export interface RegisteredUser {
  id: string;
  name: string;
  phone: string;
}

/** GET/PATCH /users/me (G8). */
export interface OwnerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  created_at: string;
}

export const usersApi = {
  /** The signed-in owner's own profile. */
  getMe: () => apiClient.get<OwnerProfile>("/users/me").then((r) => r.data),

  /** Edit name / email. Send email: null to clear it. 400 USER_ALREADY_EXISTS if the email is taken. */
  updateMe: (body: { name?: string; email?: string | null }) =>
    apiClient.patch<OwnerProfile>("/users/me", body).then((r) => r.data),

  /** Everything Sahayak stores about the owner, as JSON (G10). */
  exportMe: () => apiClient.get<Record<string, unknown>>("/users/me/export").then((r) => r.data),

  /** Delete the account (ADR-025). 409 ACCOUNT_HAS_ACTIVE_JOB while a request is live. Irreversible. */
  deleteMe: () => apiClient.delete<{ deleted: boolean }>("/users/me").then((r) => r.data),

  /**
   * Register a vehicle owner (POST /api/v1/users). Needs the bearer from phone-OTP
   * sign-in: the backend binds the new profile to that verified number, so the
   * identity comes from the token, never from this body.
   */
  createOwner: (name: string, phone: string) =>
    apiClient.post<RegisteredUser>("/users", { role: "owner", name, phone }).then((r) => r.data),
};
