import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthToken, setAuthToken } from '../services/authToken';
import { UNAUTHORIZED_EVENT } from '../services/api';
import {
  IS_SUPABASE_CONFIGURED,
  getSupabase,
  signOut as supabaseSignOut,
} from '../services/supabase';
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
  /** Store a freshly issued access token. Called by the login screen. */
  setToken: (token: string | null) => void;
  /** True until the stored Supabase session has been restored on first load. */
  isRestoringSession: boolean;
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

  // The Supabase session is read asynchronously, so on first paint we do not yet
  // know whether there is one. Route guards need to tell "signed out" apart from
  // "not checked yet" — without this they redirect to /login on every reload.
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(
    () => IS_SUPABASE_CONFIGURED
  );

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
    // Ends the Supabase session too, otherwise the listener below immediately
    // restores the token we just cleared.
    void supabaseSignOut();
  }, []);

  // The API client clears the stale token and signals here on a 401, so session
  // state resets in one place. There is no login route to redirect to yet.
  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [logout]);

  /**
   * Keep the bearer token in step with the Supabase session.
   *
   * Two jobs, and both matter on a roadside. On first load `getSession()` restores
   * the session Supabase persisted, so a reload — or a phone that locked itself
   * while the mechanic was under a car — does not send them back to the OTP
   * screen. After that, `onAuthStateChange` fires on every token refresh, and
   * Supabase access tokens are short-lived: without this the app would hold a
   * valid session whose token had expired and start taking 401s mid-job.
   */
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) {
      setIsRestoringSession(false);
      return undefined;
    }

    let cancelled = false;
    const supabase = getSupabase();

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const restored = data.session?.access_token ?? null;
        // Only overwrite when Supabase has something. A null here on a build
        // where sign-in has not happened yet must not clear a token another
        // path stored.
        if (restored) setToken(restored);
      })
      .finally(() => {
        if (!cancelled) setIsRestoringSession(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setToken(session?.access_token ?? null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{ user, role, setRole, token, setToken, isRestoringSession, logout }}
    >
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
