// ─── Sahayak Design System — Theme Tokens ─────────────────────────────────────
// Unified Blinkit Brand Palette: Yellow #F8CB46, Black #1C1C1C, Green #0C831F

import { Platform } from "react-native";

// ─── Colors ───────────────────────────────────────────────────────────────────
export const Colors = {
  // Blinkit Brand Yellow — Primary accent
  brand700: "#F8CB46",
  brand700Dark: "#E5B933",
  brand700Light: "#FEF6D8",
  brand700Muted: "#FFFCF0",

  // Brand — Blinkit Yellow (primary CTA, buttons, highlights)
  primary: "#F8CB46",
  primaryDark: "#E5B933",
  primaryDeep: "#D4A520",
  primaryLight: "#FEF6D8",
  primaryMuted: "#FFFCF0",

  // Blinkit Black — Deep charcoal (text, buttons, dark elements)
  secondary: "#1C1C1C",
  secondaryMid: "#2A2A2A",
  secondaryLight: "#3D3D3D",

  // Surfaces
  surface: "#F5F6F8",       // main background
  surfaceWhite: "#FFFFFF",  // card/sheet white
  surfaceCard: "#FFFFFF",

  // Borders
  border: "#EFF1F5",
  borderLight: "#F5F6F8",

  // Semantic — using Blinkit Green for success, Yellow for warning, muted variants for others
  success: "#0C831F",
  successLight: "#E6F4EA",
  error: "#E23744",
  errorLight: "#FDECEA",
  warning: "#F8CB46",
  warningLight: "#FEF6D8",
  info: "#1C1C1C",
  infoLight: "#F0F0F0",

  // Partner Online/Offline
  online: "#0C831F",
  offline: "#94A3B8",

  // Text hierarchy
  textPrimary: "#1C1C1C",
  textSecondary: "#5E6470",
  textMuted: "#8C93A3",
  textWhite: "#FFFFFF",
  textAmber: "#F8CB46",

  // Map overlays
  mapOverlay: "rgba(255,255,255,0.97)",
  mapShadow: "rgba(0,0,0,0.08)",

  // Partner offer alert
  offerAlertBg: "#FFFCF0",
  offerAlertBorder: "#FEF6D8",

  // Status colors — Blinkit palette only
  statusPending: "#F8CB46",
  statusActive: "#1C1C1C",
  statusComplete: "#0C831F",
  statusCancelled: "#E23744",

  // Transparent helpers
  overlay: "rgba(0,0,0,0.4)",
  overlayLight: "rgba(0,0,0,0.15)",

  // Skeleton/shimmer
  shimmerBase: "#E2E8F0",
  shimmerHighlight: "#F5F6F8",
} as const;

// ─── Typography (Uber Design System Scale) ──────────────────────────────────
export const Typography = {
  // Font families (Inter mapped to Uber Move weights)
  fontFamily: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semiBold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },

  // Font sizes matching Uber's exact scale
  fontSize: {
    xs: 11,    // micro badges, tags, chips
    sm: 13,    // secondary text, captions, subtitles (Uber standard)
    base: 14,  // standard body regular
    md: 16,    // body bold, place names, item titles (Uber standard)
    lg: 18,    // card headers, prominent actions (Uber standard)
    xl: 20,    // modal headers, sub-section titles
    "2xl": 22, // Uber section titles ("For you", "Everything in minutes")
    "3xl": 26, // screen titles, greetings
    "4xl": 32, // display / hero headings
    "5xl": 36, // splash / large hero
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    snug: 1.35,
    normal: 1.45,
    relaxed: 1.6,
  },

  // Letter spacing (Uber's signature tight grotesque character spacing)
  letterSpacing: {
    display: -0.8,
    title: -0.5,
    card: -0.3,
    body: -0.15,
    caption: 0,
    badge: 0.15,
    tighter: -0.5,
    tight: -0.25,
    normal: 0,
    wide: 0.25,
    wider: 0.5,
    widest: 1,
  },

  // Uber Character Presets
  uber: {
    display: {
      fontSize: 32,
      fontFamily: "Inter_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.8,
      color: "#1C1C1C",
      lineHeight: 38,
    },
    screenTitle: {
      fontSize: 26,
      fontFamily: "Inter_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.6,
      color: "#1C1C1C",
      lineHeight: 32,
    },
    sectionTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.4,
      color: "#1C1C1C",
      lineHeight: 28,
    },
    cardTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.3,
      color: "#1C1C1C",
      lineHeight: 24,
    },
    itemTitle: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600" as const,
      letterSpacing: -0.2,
      color: "#1C1C1C",
      lineHeight: 22,
    },
    body: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      letterSpacing: -0.15,
      color: "#5E6470",
      lineHeight: 20,
    },
    bodyMedium: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      fontWeight: "500" as const,
      letterSpacing: -0.15,
      color: "#1C1C1C",
      lineHeight: 20,
    },
    caption: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      letterSpacing: 0,
      color: "#5E6470",
      lineHeight: 16,
    },
    badge: {
      fontSize: 11,
      fontFamily: "Inter_700Bold",
      fontWeight: "700" as const,
      letterSpacing: 0.15,
      lineHeight: 14,
    },
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
  // Bottom sheet shadow
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

  // Button shadow (yellow glow)
  button: Platform.select({
    ios: {
      shadowColor: "#F8CB46",
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
    color: "#1C1C1C",
    bg: "#F0F0F0",
  },
  battery: {
    label: "Battery",
    icon: "battery-charging-outline",
    color: "#F8CB46",
    bg: "#FEF6D8",
  },
  tyre: {
    label: "Tyre",
    icon: "disc-outline",
    color: "#0C831F",
    bg: "#E6F4EA",
  },
  fuel: {
    label: "Fuel",
    icon: "water-outline",
    color: "#1C1C1C",
    bg: "#F0F0F0",
  },
  lockout: {
    label: "Lockout",
    icon: "key-outline",
    color: "#F8CB46",
    bg: "#FEF6D8",
  },
  mechanic: {
    label: "Mechanic",
    icon: "construct-outline",
    color: "#0C831F",
    bg: "#E6F4EA",
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
  no_match_found: { label: "No Match", color: Colors.warning, bg: Colors.warningLight },
} as const;
