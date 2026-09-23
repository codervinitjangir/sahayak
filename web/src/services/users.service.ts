import { apiClient } from './api';
import { setAuthToken } from './authToken';
import { User, CreateUserPayload } from '../types/users';

export const usersService = {
  /**
   * Registers a new user (default role: 'owner') via POST /api/v1/users.
   * If a JWT/token is returned in the response payload, it is stored
   * automatically for subsequent authenticated calls.
   */
  async createUser(payload: CreateUserPayload): Promise<User> {
    const res = await apiClient<User>('/users', {
      method: 'POST',
      body: JSON.stringify({
        role: 'owner',
        ...payload,
      }),
    });

    const token = res.data.token || res.data.access_token;
    if (token) {
      setAuthToken(token);
    }

    return res.data;
  },

  async getUser(userId: string): Promise<User> {
    const res = await apiClient<User>(`/users/${userId}`, {
      method: 'GET',
    });
    return res.data;
  },
};
