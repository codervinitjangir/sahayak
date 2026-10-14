export type UserRole = 'owner' | 'partner' | 'ops' | 'super_admin';

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role?: UserRole;
  phone_verified?: boolean;
  created_at?: string;
}

export interface UserRegistrationResponse {
  id: string;
  name: string;
  phone: string;
  phone_verified: boolean;
  created_at: string;
}

export interface CreateUserPayload {
  phone: string;
  name: string;
  email?: string;
  role?: UserRole;
}

