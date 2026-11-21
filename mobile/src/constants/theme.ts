// ─── Sahayak Design System: theme tokens ──────────────────────────────────────
// Single source of truth for the mobile app. Mirrors docs/DESIGN-SYSTEM.md and
// web/tailwind.config.js, so a colour means the same thing on both platforms.

import { Platform } from "react-native";

// ─── Colors ───────────────────────────────────────────────────────────────────
export const Colors = {
  // Brand: teal. brand700 is THE primary action colour (white text on it = 5.9:1).
  brand700: "#111111",
  brand700Dark: "#000000",
  brand700Light: "#E4E6EA",
  brand700Muted: "#F1F2F4",

  primary: "#111111",
  primaryDark: "#000000",
  primaryDeep: "#0B0B0C",
  primaryLight: "#E4E6EA",
  primaryMuted: "#F1F2F4",
  /** Text and icons that sit on a primary-coloured surface. */
  onPrimary: "#FFFFFF",

  // Ink
  secondary: "#0F172A",
  secondaryMid: "#1E293B",
  secondaryLight: "#334155",

  // Surfaces
  surface: "#EEF0F3", // app background
  surfaceWhite: "#FFFFFF", // cards, sheets
  surfaceCard: "#FFFFFF",

  // Borders
  border: "#E3E5E9",
  borderLight: "#F1F2F4",

  // Semantic. Never the only signal: pair with an icon and a word.
  success: "#15803D",
  successLight: "#DCFCE7",
  error: "#B91C1C",
  errorLight: "#FEE2E2",
  /** The one place red is a call to action: the emergency button. */
  emergency: "#DC2626",
  warning: "#B45309",
  warningLight: "#FEF3C7",
  info: "#0369A1",
  infoLight: "#E0F2FE",

  // Partner on/off shift
  online: "#15803D",
  offline: "#94A3B8",

  // Text hierarchy (all ≥ 4.5:1 on surfaceWhite)
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#64748B",
  textWhite: "#FFFFFF",
  textAmber: "#B45309",

  // Map overlays
  mapOverlay: "rgba(255,255,255,0.97)",
  mapShadow: "rgba(15,23,42,0.08)",

  // Partner offer card
  offerAlertBg: "#F1F2F4",
  offerAlertBorder: "#D4D7DC",

  // Status colours
  statusPending: "#B45309",
  statusActive: "#0369A1",
  statusComplete: "#15803D",
  statusCancelled: "#B91C1C",

  // Scrims
  overlay: "rgba(15,23,42,0.45)",
  overlayLight: "rgba(15,23,42,0.15)",

  // Skeleton / shimmer
  shimmerBase: "#E2E8F0",
  shimmerHighlight: "#F1F2F4",
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
// Urbanist (regular + medium lead, per the style guide). The heaviest weight is 700; `extraBold` is kept as an alias so older
// call sites resolve to a font that is actually loaded.
export const Typography = {
  fontFamily: {
    regular: "Urbanist_400Regular",
    medium: "Urbanist_500Medium",
    semiBold: "Urbanist_600SemiBold",
    bold: "Urbanist_700Bold",
    extraBold: "Urbanist_700Bold",
  },

  // Body copy is never below 15. Captions bottom out at 12.
  fontSize: {
    xs: 12,
    sm: 13,
    base: 15,
    md: 16,
    lg: 17,
    xl: 18,
    "2xl": 20,
    "3xl": 24,
    "4xl": 28,
    "5xl": 32,
  },

  lineHeight: {
    tight: 1.15,
    snug: 1.25,
    normal: 1.4,
    relaxed: 1.55,
  },

  letterSpacing: {
    display: 0,
    title: 0,
    section: 0,
    card: 0,
    body: 0,
    caption: 0,
    badge: 0.2,
    wide: 0.4,
    widest: 0.8,
  },
} as const;

// ─── Spacing (4-pt grid) ──────────────────────────────────────────────────────
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

  screenHorizontal: 20,
  screenVertical: 20,
  sectionGap: 24,
} as const;

/** Minimum touch target, in dp (Material 48dp; Apple's 44pt is covered). */
export const TouchTarget = 48;

// ─── Border radius ────────────────────────────────────────────────────────────
export const Radius = {
  xs: 6,
  sm: 8,
  md: 16, // controls
  lg: 24, // cards
  xl: 28,
  "2xl": 32, // sheet top corners
  "3xl": 40,
  full: 9999,
} as const;

// ─── Shadows: two levels only ─────────────────────────────────────────────────
export const Shadows = {
  sheet: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
    },
    android: { elevation: 8 },
  }),

  card: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
    },
    android: { elevation: 1 },
  }),

  button: Platform.select({
    ios: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
  }),

  floating: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
  }),
} as const;

// ─── Animation durations ──────────────────────────────────────────────────────
export const Duration = {
  fast: 150,
  normal: 220,
  slow: 350,
  verySlow: 600,
} as const;

// ─── Service types ────────────────────────────────────────────────────────────
export type ServiceType =
  | "towing"
  | "battery"
  | "tyre"
  | "lockout"
  | "mechanic"
  | "wash";

export const ServiceConfig: Record<
  ServiceType,
  { label: string; icon: string; color: string; bg: string }
> = {
  towing: { label: "Towing", icon: "car-outline", color: "#0F172A", bg: "#F1F5F9" },
  battery: { label: "Battery", icon: "battery-charging-outline", color: "#B45309", bg: "#FEF3C7" },
  tyre: { label: "Flat tyre", icon: "disc-outline", color: "#111111", bg: "#E4E6EA" },
  lockout: { label: "Lockout", icon: "key-outline", color: "#7C3AED", bg: "#EDE9FE" },
  mechanic: { label: "Repair", icon: "construct-outline", color: "#15803D", bg: "#DCFCE7" },
  wash: { label: "Car wash", icon: "water-outline", color: "#0369A1", bg: "#E0F2FE" },
};

// ─── Status labels (icon + word + colour, never colour alone) ─────────────────
export const JobStatusConfig = {
  pending: { label: "Pending", color: Colors.statusPending, bg: Colors.warningLight },
  searching: { label: "Finding a partner", color: Colors.statusPending, bg: Colors.warningLight },
  matched: { label: "Partner assigned", color: Colors.info, bg: Colors.infoLight },
  en_route: { label: "On the way", color: Colors.info, bg: Colors.infoLight },
  arrived: { label: "Arrived", color: Colors.success, bg: Colors.successLight },
  in_progress: { label: "In progress", color: Colors.info, bg: Colors.infoLight },
  complete: { label: "Completed", color: Colors.success, bg: Colors.successLight },
  cancelled: { label: "Cancelled", color: Colors.error, bg: Colors.errorLight },
  no_match_found: { label: "No partner found", color: Colors.warning, bg: Colors.warningLight },
  scheduled: { label: "Booked", color: Colors.info, bg: Colors.infoLight },
} as const;

// ─── Hero header (shared screen template) ─────────────────────────────────────
// Every top-level screen opens with the same dark hero: rounded bottom corners,
// greeting/title in white, an optional frosted pill underneath.
export const Hero = {
  bg: "#141518",
  bgSoft: "#24262B",
  glass: "rgba(255,255,255,0.16)",
  glassBorder: "rgba(255,255,255,0.22)",
  textSoft: "rgba(255,255,255,0.72)",
  radius: 32,
} as const;
