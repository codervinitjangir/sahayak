import { apiClient } from "./client";

export interface RegisteredUser {
  id: string;
  name: string;
  phone: string;
}

export const usersApi = {
  /**
   * Register a vehicle owner (POST /api/v1/users). Needs the bearer from phone-OTP
   * sign-in: the backend binds the new profile to that verified number, so the
   * identity comes from the token, never from this body.
   */
  createOwner: (name: string, phone: string) =>
    apiClient.post<RegisteredUser>("/users", { role: "owner", name, phone }).then((r) => r.data),
};
