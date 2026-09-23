import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthToken, setAuthToken } from '../services/authToken';
import { UNAUTHORIZED_EVENT } from '../services/api';
import { IS_DEMO_MODE } from './config';

export type UserRole = 'owner' | 'partner' | 'ops' | 'super_admin';

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
}

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole;
  setRole: (role: UserRole) => void;
  token: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_STORAGE_KEY = 'sahayak_role';

/**
 * Seeded identities for the navbar role switcher. These exist purely so the three
 * role views can be demoed without a backend, and are gated behind IS_DEMO_MODE so
 * they cannot reach a production build. Real sign-in is not implemented yet.
 */
const DEMO_IDENTITIES: Record<UserRole, UserProfile> = {
  owner: {
    id: 'usr_owner_01',
    name: 'Asha Sharma',
    phone: '+91 98765 43210',
    email: 'asha@example.com',
    role: 'owner',
  },
  partner: {
    id: 'ptr_ramesh_01',
    name: 'Ramesh Kumar (Speedy Mechanics)',
    phone: '+91 98111 22334',
    role: 'partner',
  },
  ops: {
    id: 'adm_ops_01',
    name: 'Sahayak Ops Console',
    phone: '+91 98000 11223',
    email: 'ops@sahayak.in',
    role: 'ops',
  },
  super_admin: {
    id: 'adm_ops_01',
    name: 'Sahayak Ops Console',
    phone: '+91 98000 11223',
    email: 'ops@sahayak.in',
    role: 'super_admin',
  },
};

function readStoredRole(): UserRole {
  try {
    return (localStorage.getItem(ROLE_STORAGE_KEY) as UserRole) || 'owner';
  } catch {
    return 'owner';
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to 'owner' for demo & development convenience
  const [role, setRoleState] = useState<UserRole>(readStoredRole);

  // Only ever a token a real sign-in produced. Previously this defaulted to a
  // hardcoded fake JWT that was persisted and then sent as a real bearer header.
  const [token, setToken] = useState<string | null>(() => getAuthToken());

  const [user, setUser] = useState<UserProfile | null>(() =>
    IS_DEMO_MODE ? DEMO_IDENTITIES[readStoredRole()] : null
  );

  const setRole = (newRole: UserRole) => {
    setRoleState(newRole);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, newRole);
    } catch {
      // Storage unavailable — role simply will not persist across reloads.
    }
    if (IS_DEMO_MODE) {
      setUser(DEMO_IDENTITIES[newRole]);
    }
  };

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setAuthToken(null);
  }, []);

  // The API client clears the stale token and signals here on a 401, so session
  // state resets in one place. There is no login route to redirect to yet.
  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, role, setRole, token, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const useOptionalAuth = () => {
  return useContext(AuthContext);
};
