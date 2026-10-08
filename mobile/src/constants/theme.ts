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

// ─── Typography (Blinkit / Gilroy-Equivalent — Poppins Geometric Sans-Serif) ──
export const Typography = {
  // Font families — Poppins mapped to Blinkit's Gilroy weight hierarchy
  fontFamily: {
    regular: "Poppins_400Regular",      // body text, descriptions, menu items
    medium: "Poppins_500Medium",        // addresses, subtitles, nav labels
    semiBold: "Poppins_600SemiBold",    // context labels ("Blinkit in"), badges
    bold: "Poppins_700Bold",            // section headings, card titles, buttons
    extraBold: "Poppins_800ExtraBold",  // ETA numbers, page titles, hero display text
  },

  // Font sizes — Blinkit-accurate scale from screenshot pixel analysis
  fontSize: {
    xs: 10,    // bottom nav labels, micro badges
    sm: 12,    // captions, old prices, category card labels
    base: 13,  // secondary text, addresses, bullet descriptions
    md: 14,    // body text, search placeholder, button text
    lg: 15,    // menu items, prices, item titles
    xl: 16,    // sub-section titles ("Your information")
    "2xl": 18, // section headings ("Grocery & Kitchen", "Snacks & Drinks")
    "3xl": 22, // page titles ("Your account")
    "4xl": 24, // ETA headline ("23 minutes")
    "5xl": 28, // display headings ("Print Store")
  },

  // Line heights — tighter than Inter, matching Gilroy's compact geometric feel
  lineHeight: {
    tight: 1.15,    // display/hero text
    snug: 1.25,     // headings, ETA
    normal: 1.4,    // body text
    relaxed: 1.55,  // long-form descriptions
  },

  // Letter spacing — Blinkit's signature tight headings, neutral body
  letterSpacing: {
    display: -0.8,   // hero/display headings (28px+)
    title: -0.6,     // ETA numbers, page titles (22-24px)
    section: -0.3,   // section headings (18px)
    card: -0.2,      // card/item titles (15-16px)
    body: 0,         // body text, descriptions (13-14px)
    caption: 0,      // captions, labels (10-12px)
    badge: 0.2,      // context labels ("Blinkit in"), small badges
    wide: 0.4,       // uppercase micro-badges
    widest: 0.8,     // tracking-wide decorative elements
  },

  // Blinkit Character Presets (pixel-accurate from screenshot analysis)
  blinkit: {
    // "Print Store" — largest display heading
    display: {
      fontSize: 28,
      fontFamily: "Poppins_800ExtraBold",
      fontWeight: "800" as const,
      letterSpacing: -0.8,
      color: "#1C1C1C",
      lineHeight: 32,
    },
    // "23 minutes" — hero ETA number
    etaHeadline: {
      fontSize: 24,
      fontFamily: "Poppins_800ExtraBold",
      fontWeight: "800" as const,
      letterSpacing: -0.6,
      color: "#1C1C1C",
      lineHeight: 28,
    },
    // "Your account" — page-level titles
    pageTitle: {
      fontSize: 22,
      fontFamily: "Poppins_800ExtraBold",
      fontWeight: "800" as const,
      letterSpacing: -0.4,
      color: "#1C1C1C",
      lineHeight: 26,
    },
    // "Grocery & Kitchen" — section headings
    sectionTitle: {
      fontSize: 18,
      fontFamily: "Poppins_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.3,
      color: "#1C1C1C",
      lineHeight: 22,
    },
    // "Your information" — sub-section headings
    subSectionTitle: {
      fontSize: 16,
      fontFamily: "Poppins_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.2,
      color: "#1C1C1C",
      lineHeight: 20,
    },
    // "Address book", "Payment settings" — menu items
    menuItem: {
      fontSize: 15,
      fontFamily: "Poppins_400Regular",
      letterSpacing: 0,
      color: "#1C1C1C",
      lineHeight: 20,
    },
    // Body text, descriptions
    body: {
      fontSize: 14,
      fontFamily: "Poppins_400Regular",
      letterSpacing: 0,
      color: "#5E6470",
      lineHeight: 20,
    },
    // Address, location line
    bodyMedium: {
      fontSize: 13,
      fontFamily: "Poppins_500Medium",
      fontWeight: "500" as const,
      letterSpacing: 0,
      color: "#1C1C1C",
      lineHeight: 18,
    },
    // "Blinkit in" — small context label above ETA
    contextLabel: {
      fontSize: 11,
      fontFamily: "Poppins_600SemiBold",
      fontWeight: "600" as const,
      letterSpacing: 0.2,
      color: "#1C1C1C",
      lineHeight: 14,
    },
    // Captions, category labels, old prices
    caption: {
      fontSize: 12,
      fontFamily: "Poppins_400Regular",
      letterSpacing: 0,
      color: "#5E6470",
      lineHeight: 16,
    },
    // Bottom nav labels, micro badges
    badge: {
      fontSize: 10,
      fontFamily: "Poppins_500Medium",
      fontWeight: "500" as const,
      letterSpacing: 0,
      lineHeight: 14,
    },
    // Button text
    button: {
      fontSize: 14,
      fontFamily: "Poppins_700Bold",
      fontWeight: "700" as const,
      letterSpacing: 0,
      lineHeight: 18,
    },
    // Price display
    price: {
      fontSize: 15,
      fontFamily: "Poppins_700Bold",
      fontWeight: "700" as const,
      letterSpacing: -0.2,
      color: "#1C1C1C",
      lineHeight: 18,
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
