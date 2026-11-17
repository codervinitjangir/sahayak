import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { getAuthToken, setAuthToken, TOKEN_STORAGE_KEY } from '../services/authToken';
import { UNAUTHORIZED_EVENT } from '../services/api';
import { identityService } from '../services/identity.service';
import {
  IS_SUPABASE_CONFIGURED,
  getSupabase,
  signOut as supabaseSignOut,
} from '../services/supabase';

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
  /**
   * 'restoring' until the stored session and the backend identity are both
   * known; route guards and the login page wait on it so a signed-in visitor
   * never sees a flash of the login form.
   */
  status: 'restoring' | 'signed-out' | 'ready';
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_STORAGE_KEY = 'sahayak_role';

function readStoredRole(): UserRole {
  try {
    return (localStorage.getItem(ROLE_STORAGE_KEY) as UserRole) || 'owner';
  } catch {
    return 'owner';
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRoleState] = useState<UserRole>(readStoredRole);

  const [token, setToken] = useState<string | null>(() => getAuthToken());

  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(
    () => IS_SUPABASE_CONFIGURED
  );

  const [user, setUser] = useState<UserProfile | null>(null);
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  // Optional so the provider also mounts in tests without a query cache.
  const queryClient = useContext(QueryClientContext);
  const lastIdentityId = useRef<string | null>(null);

  const setRole = (newRole: UserRole) => {
    setRoleState(newRole);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, newRole);
    } catch {
      // Storage unavailable — role simply will not persist across reloads.
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

  // Every tab of this site shares one sign-in. When another tab signs in as a
  // different account (or signs out), adopt its token here too instead of
  // carrying on with a stale one and a stale role.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_STORAGE_KEY) setToken(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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

  // Who is signed in, for the header (and its Sign out button). Resolved from
  // the backend on every token change; a token that maps to no profile yet
  // (mid-signup) still counts as signed in so the visitor can sign out.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setResolvedFor(null);
      if (lastIdentityId.current !== null) {
        lastIdentityId.current = null;
        queryClient?.clear();
      }
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      let phone = '';
      if (IS_SUPABASE_CONFIGURED) {
        try {
          const { data } = await getSupabase().auth.getSession();
          phone = data.session?.user?.phone ? `+${data.session.user.phone.replace(/^\+/, '')}` : '';
        } catch {
          // Phone is cosmetic here.
        }
      }
      // Retry through a backend cold start (Render free tier sleeps when idle)
      // instead of treating "server still waking up" as "not signed in".
      let resolved = await identityService.resolve();
      for (const wait of [3000, 8000, 15000, 30000]) {
        if (cancelled || resolved.kind !== 'error') break;
        await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        resolved = await identityService.resolve();
      }
      if (cancelled) return;
      const backendRole = resolved.kind === 'registered' ? resolved.identity.role : undefined;
      const identityId = resolved.kind === 'registered' ? `${backendRole}:${resolved.identity.id}` : `anon:${phone}`;
      // A different account now owns this tab: nothing cached for the previous
      // one (profile, jobs, vehicles) may be shown or reused.
      if (lastIdentityId.current !== null && lastIdentityId.current !== identityId) {
        queryClient?.clear();
      }
      lastIdentityId.current = identityId;
      if (backendRole) {
        // The backend decides the role; the stored value is only a hint used
        // before this resolves.
        setRole(backendRole === 'partner' ? 'partner' : backendRole === 'admin' ? 'ops' : 'owner');
      }
      setResolvedFor(token);
      setUser({
        id: resolved.kind === 'registered' ? resolved.identity.id : '',
        name: backendRole === 'partner' ? 'Partner' : backendRole === 'admin' ? 'Admin' : 'Owner',
        phone,
        role: backendRole === 'partner' ? 'partner' : backendRole === 'admin' ? 'ops' : 'owner',
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const status: AuthContextType['status'] = isRestoringSession
    ? 'restoring'
    : !token
      ? 'signed-out'
      : resolvedFor === token
        ? 'ready'
        : 'restoring';

  return (
    <AuthContext.Provider
      value={{ user, role, setRole, token, setToken, isRestoringSession, status, logout }}
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
