// ─── Sahayak — Auth Store (Zustand) ───────────────────────────────────────────
import { create } from "zustand";
import type { User, UserRole } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  setUser: (user: User, token: string) => void;
  logout: () => void;
  setLoading: (v: boolean) => void;
}

const DEFAULT_DEV_USER: User = {
  id: "usr_mock_01",
  name: "Arjun Sharma",
  phone: "9876543210",
  email: "arjun@example.com",
  role: "owner",
  createdAt: new Date().toISOString(),
};

export const useAuthStore = create<AuthState>((set) => ({
  user: DEFAULT_DEV_USER,
  token: "mock_jwt_owner",
  isAuthenticated: true,
  isLoading: false,

  setUser: (user, token) =>
    set({ user, token, isAuthenticated: true, isLoading: false }),

  logout: () =>
    set({ user: null, token: null, isAuthenticated: false }),

  setLoading: (v) => set({ isLoading: v }),
}));

// ─── Selectors ────────────────────────────────────────────────────────────────
export const useRole = (): UserRole | null =>
  useAuthStore((s) => s.user?.role ?? null);

export const useIsOwner = () => useAuthStore((s) => s.user?.role === "owner");
export const useIsPartner = () => useAuthStore((s) => s.user?.role === "partner");
