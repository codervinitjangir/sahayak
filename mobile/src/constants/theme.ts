// ─── Sahayak Design System — Theme Tokens ─────────────────────────────────────
// Derived from Figma file eowkt2mOmYt8QdZTSc1ubO
// Inspired by: GoMechanic, ReadyAssist, AchoDrive, Urgently

import { Platform } from "react-native";

// ─── Colors ───────────────────────────────────────────────────────────────────
export const Colors = {
  // Brand — Sahayak Amber (matches Figma CTA #F59E0B)
  primary: "#F59E0B",
  primaryDark: "#D97706",
  primaryDeep: "#B45309",
  primaryLight: "#FEF3C7",
  primaryMuted: "#FFFBEB",

  // Trust — Deep Navy (reliability, authority)
  secondary: "#1E293B",
  secondaryMid: "#334155",
  secondaryLight: "#475569",

  // Surfaces (from Figma fills)
  surface: "#F8FAFC",       // fill_85065e9e — main background
  surfaceWhite: "#FFFFFF",  // fill_658ab2fa — card/sheet white
  surfaceCard: "#FFFFFF",

  // Borders (from Figma strokes)
  border: "#E5E7EB",        // fill_b8e4da24
  borderLight: "#F1F5F9",

  // Semantic
  success: "#10B981",
  successLight: "#D1FAE5",
  error: "#EF4444",
  errorLight: "#FEE2E2",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  info: "#3B82F6",
  infoLight: "#DBEAFE",

  // Partner Online/Offline
  online: "#10B981",
  offline: "#94A3B8",

  // Text hierarchy
  textPrimary: "#1E293B",
  textSecondary: "#64748B",
  textMuted: "#94A3B8",
  textWhite: "#FFFFFF",
  textAmber: "#F59E0B",

  // Map overlays
  mapOverlay: "rgba(255,255,255,0.97)",
  mapShadow: "rgba(0,0,0,0.08)",

  // Partner offer alert (warm orange tint — from Figma #FFF7ED)
  offerAlertBg: "#FFF7ED",
  offerAlertBorder: "#FED7AA",

  // Status colors
  statusPending: "#F59E0B",
  statusActive: "#3B82F6",
  statusComplete: "#10B981",
  statusCancelled: "#EF4444",

  // Transparent helpers
  overlay: "rgba(0,0,0,0.4)",
  overlayLight: "rgba(0,0,0,0.15)",

  // Skeleton/shimmer
  shimmerBase: "#E2E8F0",
  shimmerHighlight: "#F8FAFC",
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
export const Typography = {
  // Font families
  fontFamily: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semiBold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },

  // Font sizes
  fontSize: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 15,
    lg: 16,
    xl: 18,
    "2xl": 20,
    "3xl": 24,
    "4xl": 28,
    "5xl": 32,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    snug: 1.35,
    normal: 1.5,
    relaxed: 1.625,
  },

  // Letter spacing
  letterSpacing: {
    tighter: -0.5,
    tight: -0.25,
    normal: 0,
    wide: 0.25,
    wider: 0.5,
    widest: 1,
  },
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  "4xl": 48,
  "5xl": 64,

  // Screen padding (matches Figma 20-24px layout padding)
  screenHorizontal: 20,
  screenVertical: 20,
  sectionGap: 24,
} as const;

// ─── Border Radius ─────────────────────────────────────────────────────────────
export const Radius = {
  xs: 6,
  sm: 8,
  md: 12,     // buttons (from Figma CTA borderRadius: 12px)
  lg: 16,
  xl: 20,
  "2xl": 24,  // bottom sheets top corners (Figma: "24px 24px 0px 0px")
  "3xl": 32,  // main screen frames (Figma: borderRadius: 32px)
  full: 9999,
} as const;

// ─── Shadows ──────────────────────────────────────────────────────────────────
export const Shadows = {
  // Bottom sheet shadow (from Figma effect_c95be0f5: boxShadow: 0px -8px 24px rgba(0,0,0,0.08))
  sheet: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
    },
    android: {
      elevation: 8,
    },
  }),

  // Card shadow
  card: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
    },
    android: {
      elevation: 3,
    },
  }),

  // Button shadow (amber glow)
  button: Platform.select({
    ios: {
      shadowColor: "#F59E0B",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
    },
    android: {
      elevation: 6,
    },
  }),

  // Floating element (map overlays)
  floating: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
    },
    android: {
      elevation: 10,
    },
  }),
} as const;

// ─── Animation Durations ──────────────────────────────────────────────────────
export const Duration = {
  fast: 150,
  normal: 250,
  slow: 400,
  verySlow: 600,
} as const;

// ─── Service Types ─────────────────────────────────────────────────────────────
export type ServiceType =
  | "towing"
  | "battery"
  | "tyre"
  | "fuel"
  | "lockout"
  | "mechanic";

export const ServiceConfig: Record<
  ServiceType,
  { label: string; icon: string; color: string; bg: string }
> = {
  towing: {
    label: "Towing",
    icon: "car-outline",
    color: "#3B82F6",
    bg: "#DBEAFE",
  },
  battery: {
    label: "Battery",
    icon: "battery-charging-outline",
    color: "#F59E0B",
    bg: "#FEF3C7",
  },
  tyre: {
    label: "Tyre",
    icon: "disc-outline",
    color: "#10B981",
    bg: "#D1FAE5",
  },
  fuel: {
    label: "Fuel",
    icon: "water-outline",
    color: "#EF4444",
    bg: "#FEE2E2",
  },
  lockout: {
    label: "Lockout",
    icon: "key-outline",
    color: "#8B5CF6",
    bg: "#EDE9FE",
  },
  mechanic: {
    label: "Mechanic",
    icon: "construct-outline",
    color: "#F97316",
    bg: "#FFEDD5",
  },
};

// ─── Status Labels ─────────────────────────────────────────────────────────────
export const JobStatusConfig = {
  pending: { label: "Pending", color: Colors.statusPending, bg: Colors.warningLight },
  searching: { label: "Searching", color: Colors.info, bg: Colors.infoLight },
  matched: { label: "Partner Matched", color: Colors.info, bg: Colors.infoLight },
  en_route: { label: "En Route", color: Colors.info, bg: Colors.infoLight },
  arrived: { label: "Arrived", color: Colors.success, bg: Colors.successLight },
  in_progress: { label: "In Progress", color: Colors.info, bg: Colors.infoLight },
  complete: { label: "Complete", color: Colors.success, bg: Colors.successLight },
  cancelled: { label: "Cancelled", color: Colors.error, bg: Colors.errorLight },
} as const;
