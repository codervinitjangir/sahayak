// ─── Sahayak — Auth Store (Zustand) ───────────────────────────────────────────
import { create } from "zustand";

import {
  IS_SUPABASE_CONFIGURED,
  getSupabase,
  signOut as supabaseSignOut,
} from "../services/supabase";
import type { BackendRole } from "../services/identity";
import type { User, UserRole } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True until the stored Supabase session has been looked for on launch. */
  isRestoringSession: boolean;

  // Actions
  setUser: (user: User, token: string) => void;
  /**
   * Show a placeholder profile with **no token**, for browsing the mocked screens.
   *
   * Separate from setUser because the difference is security, not convenience: the
   * request interceptor sends whatever is in `token`, so a demo path that passed a
   * string like "mock_jwt_token" would put a forged bearer on every request the
   * moment any screen talked to the real backend. This keeps "looking at the UI"
   * and "signed in" from sharing a code path.
   */
  setDemoUser: (user: User) => void;
  /** Store a token on its own — the session is the source of truth, not the profile. */
  setToken: (token: string | null) => void;
  logout: () => void;
  setLoading: (v: boolean) => void;
  /** Subscribe to the Supabase session. Call once, from the app root. */
  initSession: () => () => void;
}

/**
 * A placeholder profile so the mocked screens have a name and an avatar to render
 * before anyone signs in.
 *
 * It carries no token, and that distinction is the whole point: `token` is what
 * the request interceptor sends, and it is only ever set by a real Supabase
 * session. Until 2026-10-07 this store shipped `token: "mock_jwt_owner"` — which
 * went nowhere while the interceptor was commented out, and would have been sent
 * as a real bearer the moment it was not.
 */
const DEFAULT_DEV_USER: User = {
  id: "usr_mock_01",
  name: "Arjun Sharma",
  phone: "9876543210",
  email: "arjun@example.com",
  role: "owner",
  createdAt: new Date().toISOString(),
};

/** The backend's role vocabulary, mapped onto this app's. */
export function appRoleFor(role: BackendRole): UserRole {
  // "admin" has no mobile surface — there is no ops app — so an admin account
  // lands on the owner screens rather than a blank one. Web does the same.
  return role === "partner" ? "partner" : "owner";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: DEFAULT_DEV_USER,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isRestoringSession: IS_SUPABASE_CONFIGURED,

  setUser: (user, token) =>
    set({ user, token, isAuthenticated: true, isLoading: false }),

  setDemoUser: (user) =>
    set({ user, token: null, isAuthenticated: false, isLoading: false }),

  setToken: (token) => set({ token, isAuthenticated: Boolean(token) }),

  logout: () => {
    set({ user: null, token: null, isAuthenticated: false });
    // Ends the Supabase session too, or the subscription below immediately
    // restores the token this just cleared.
    void supabaseSignOut();
  },

  setLoading: (v) => set({ isLoading: v }),

  /**
   * Keep `token` in step with the Supabase session, and return the unsubscribe.
   *
   * Two jobs, and both matter in the field. On launch `getSession()` restores what
   * Supabase persisted to AsyncStorage, so a mechanic whose phone died under a car
   * does not come back to the OTP screen. After that `onAuthStateChange` fires on
   * every refresh — Supabase access tokens are short-lived, and without this the
   * app would hold a valid session whose token had expired and start taking 401s
   * part-way through a job.
   */
  initSession: () => {
    if (!IS_SUPABASE_CONFIGURED) {
      set({ isRestoringSession: false });
      return () => undefined;
    }

    let cancelled = false;
    const supabase = getSupabase();

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const restored = data.session?.access_token ?? null;
        // Only overwrite when Supabase has something: a null here must not clear a
        // token the sign-in screen has just stored, which is a race on first launch.
        if (restored) get().setToken(restored);
      })
      .finally(() => {
        if (!cancelled) set({ isRestoringSession: false });
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      get().setToken(session?.access_token ?? null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────
export const useRole = (): UserRole | null =>
  useAuthStore((s) => s.user?.role ?? null);

export const useIsOwner = () => useAuthStore((s) => s.user?.role === "owner");
export const useIsPartner = () => useAuthStore((s) => s.user?.role === "partner");
