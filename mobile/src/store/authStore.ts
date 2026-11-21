import AsyncStorage from "@react-native-async-storage/async-storage";
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
  /** Profile that acts on each request: owner ("user") or partner (ADR-034). */
  activeProfile: "user" | "partner";
  /** Profiles this login owns, from GET /auth/me. */
  profiles: BackendRole[];
  /** Choose the acting profile for the next requests (persisted on device). */
  setActiveProfile: (p: "user" | "partner") => void;
  /** Switch profile and re-resolve the identity; the navigator follows user.role. */
  switchProfile: (p: "user" | "partner") => Promise<boolean>;
  /** Subscribe to the Supabase session. Call once, from the app root. */
  initSession: () => () => void;
}

/** The backend's role vocabulary, mapped onto this app's. */
export function appRoleFor(role: BackendRole): UserRole {
  // "admin" has no mobile surface — there is no ops app — so an admin account
  // lands on the owner screens rather than a blank one. Web does the same.
  return role === "partner" ? "partner" : "owner";
}

/** Lazy so tests and web never load the native notifications module. */
function registerPushLater(): void {
  void import("../services/push").then((m) => m.registerForPush()).catch(() => undefined);
}

// ─── Last signed-in account, kept on the device ──────────────────────────────
// Only what the router needs (id, role, display name, phone). It is a hint for
// opening the right screens before the backend answers, never an authority:
// every request still carries the Supabase token and the backend re-checks it.
const USER_CACHE_KEY = "sahayak_last_user";
const PROFILE_KEY = "sahayak_active_profile";

async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
async function writeCachedUser(user: User): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Cache is a convenience only.
  }
}
async function clearCachedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_CACHE_KEY);
  } catch {
    // ignore
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isRestoringSession: IS_SUPABASE_CONFIGURED,
  activeProfile: "user",
  profiles: [],

  setActiveProfile: (p) => {
    set({ activeProfile: p });
    void AsyncStorage.setItem(PROFILE_KEY, p).catch(() => undefined);
  },

  switchProfile: async (p) => {
    const prev = get().activeProfile;
    get().setActiveProfile(p);
    const { identityService } = await import("../services/identity");
    const resolution = await identityService.resolve();
    if (resolution.kind !== "registered" || appRoleFor(resolution.identity.role) !== (p === "partner" ? "partner" : "owner")) {
      get().setActiveProfile(prev);
      return false;
    }
    const role = appRoleFor(resolution.identity.role);
    const current = get().user;
    const user: User = {
      id: resolution.identity.id,
      phone: current?.phone ?? "",
      role,
      name: role === "partner" ? "Service partner" : "Vehicle owner",
    };
    set({ user, profiles: resolution.identity.profiles ?? [resolution.identity.role] });
    void writeCachedUser(user);
    return true;
  },

  setUser: (user, token) => {
    set({ user, token, isAuthenticated: true, isLoading: false });
    void writeCachedUser(user);
    registerPushLater();
  },

  setGuestUser: (user) =>
    set({ user, token: null, isAuthenticated: false, isLoading: false }),

  setToken: (token) => set({ token, isAuthenticated: Boolean(token) }),

  logout: () => {
    const authToken = get().token;
    set({ user: null, token: null, isAuthenticated: false });
    void clearCachedUser();
    // ADR-049: never keep sharing a signed-out partner's position.
    void import("../features/partner/jobLocationTracking")
      .then((m) => m.stopJobTracking())
      .catch(() => undefined);
    // Drop this device's push token first (it needs the old access token), then
    // end the Supabase session, or the subscription below restores the token.
    void import("../services/push")
      .then((m) => m.unregisterPush(authToken))
      .catch(() => undefined)
      .finally(() => void supabaseSignOut());
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
        if (!restored) {
          void clearCachedUser();
          return;
        }
        get().setToken(restored);
        try {
          const saved = await AsyncStorage.getItem(PROFILE_KEY);
          if (saved === "user" || saved === "partner") set({ activeProfile: saved });
        } catch {
          // default profile stands
        }
        // Open straight into the app with the account this phone last used, so
        // a slow or sleeping backend (Render free tier wakes in ~30-50 s) does
        // not drop a signed-in partner back on the OTP screen.
        const cached = await readCachedUser();
        if (cached && !cancelled) {
          set({ user: cached, isAuthenticated: true, isRestoringSession: false });
          registerPushLater();
        }
        await confirmIdentity(data.session?.user?.phone || "", () => cancelled, Boolean(cached));
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
        void clearCachedUser();
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

/**
 * Ask the backend who this token belongs to, retrying through a cold start.
 * A definite answer (registered / not registered) wins over the cache; a
 * network or 5xx failure keeps the cached account and keeps trying.
 */
async function confirmIdentity(phone: string, isCancelled: () => boolean, hasCache: boolean): Promise<void> {
  const { identityService } = await import("../services/identity");
  const delays = [0, 3000, 8000, 15000, 30000];
  for (const wait of delays) {
    if (wait) await sleep(wait);
    if (isCancelled()) return;
    const resolution = await identityService.resolve();
    if (isCancelled()) return;
    if (resolution.kind === "registered") {
      const role = appRoleFor(resolution.identity.role);
      const prev = useAuthStore.getState().user;
      const user: User = {
        id: resolution.identity.id,
        phone: phone || prev?.phone || "",
        role,
        name:
          prev && prev.id === resolution.identity.id && prev.name
            ? prev.name
            : role === "partner" ? "Service partner" : "Vehicle owner",
      };
      useAuthStore.setState({
        user, isAuthenticated: true, isRestoringSession: false,
        profiles: resolution.identity.profiles ?? [resolution.identity.role],
      });
      void writeCachedUser(user);
      if (!hasCache) registerPushLater();
      return;
    }
    if (resolution.kind === "needs-signup" || resolution.kind === "needs-linking") {
      // The token is real but has no profile: the login flow handles signup.
      useAuthStore.setState({ user: null, isRestoringSession: false });
      void clearCachedUser();
      return;
    }
    // kind === "error": cold start or offline, try again.
  }
}
