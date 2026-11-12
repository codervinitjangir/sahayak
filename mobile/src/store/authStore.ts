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
  /** Set an unauthenticated guest user with no token */
  setGuestUser: (user: User) => void;
  /** Store a token on its own — the session is the source of truth, not the profile. */
  setToken: (token: string | null) => void;
  logout: () => void;
  setLoading: (v: boolean) => void;
  /** Subscribe to the Supabase session. Call once, from the app root. */
  initSession: () => () => void;
}

/** The backend's role vocabulary, mapped onto this app's. */
export function appRoleFor(role: BackendRole): UserRole {
  // "admin" has no mobile surface — there is no ops app — so an admin account
  // lands on the owner screens rather than a blank one. Web does the same.
  return role === "partner" ? "partner" : "owner";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isRestoringSession: IS_SUPABASE_CONFIGURED,

  setUser: (user, token) =>
    set({ user, token, isAuthenticated: true, isLoading: false }),

  setGuestUser: (user) =>
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
      .then(async ({ data }) => {
        if (cancelled) return;
        const restored = data.session?.access_token ?? null;
        if (restored) {
          get().setToken(restored);
          try {
            const { identityService } = await import("../services/identity");
            const resolution = await identityService.resolve();
            if (resolution.kind === "registered" && !cancelled) {
              const role = appRoleFor(resolution.identity.role);
              set({
                user: {
                  id: resolution.identity.id,
                  phone: data.session?.user?.phone || "",
                  role,
                  name: role === "partner" ? "Partner Driver" : "Vehicle Owner",
                  rating: 5.0,
                  totalJobs: 0,
                  isVerified: true,
                },
                isAuthenticated: true,
              });
            }
          } catch {
            // Leave user as is if offline
          }
        }
      })
      .finally(() => {
        if (!cancelled) set({ isRestoringSession: false });
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const nextToken = session?.access_token ?? null;
      get().setToken(nextToken);
      if (event === "SIGNED_OUT" || !nextToken) {
        set({ user: null, token: null, isAuthenticated: false });
      }
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
