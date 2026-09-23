export type UserRole = 'owner' | 'partner' | 'ops' | 'super_admin';

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  created_at?: string;
  token?: string;
  access_token?: string;
}

export interface CreateUserPayload {
  phone: string;
  name: string;
  email?: string;
  role?: UserRole;
}
