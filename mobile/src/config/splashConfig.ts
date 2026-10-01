// ─── Sahayak Opening Sequence Brand & Timing Configuration ───────────────────
// Centralized configuration based on reference specifications & keyframe measurements.

export interface Keyframe {
  t: number;
  x: number;
  y: number;
  size: number;
}

// 14 Keyframes Measured from Reference Recording (Fraction of Screen Width & Height)
// These are relative to motion start (t_rel = 0.00s when the star leaves the logo)
export const STAR_KEYFRAMES: readonly Keyframe[] = [
  { t: 0.00, x: 0.277, y: 0.490, size: 0.084 },
  { t: 0.03, x: 0.275, y: 0.499, size: 0.088 },
  { t: 0.07, x: 0.393, y: 0.529, size: 0.098 },
  { t: 0.13, x: 0.642, y: 0.526, size: 0.120 },
  { t: 0.20, x: 0.723, y: 0.486, size: 0.130 },
  { t: 0.27, x: 0.645, y: 0.439, size: 0.130 },
  { t: 0.33, x: 0.572, y: 0.443, size: 0.108 },
  { t: 0.40, x: 0.549, y: 0.453, size: 0.090 },
  { t: 0.43, x: 0.523, y: 0.471, size: 0.072 },
  { t: 0.50, x: 0.514, y: 0.479, size: 0.068 },
  { t: 0.53, x: 0.503, y: 0.487, size: 0.058 },
  { t: 0.60, x: 0.500, y: 0.492, size: 0.055 },
  { t: 0.67, x: 0.497, y: 0.493, size: 0.054 },
  { t: 0.84, x: 0.497, y: 0.493, size: 0.052 },
] as const;

export const splashConfig = {
  // Brand Colors (Swish green measured placeholder)
  colors: {
    brand: "#38CF5A",
    brandHalfOpacity: "rgba(56, 207, 90, 0.5)",
    text: "#FFFFFF",
    tagline: "rgba(255, 255, 255, 0.92)",
    footerText: "#FFFFFF",
    footerIcon: "#FFFFFF",
  },

  // Typography & Content for Sahayak Roadside Rescue (crispy 2-word cadence matching screenshot)
  content: {
    wordmark: "sahayak",
    tagline: "10-MINUTE ROADSIDE RESCUE",
    footerLine1: "Rescue Fast",
    footerLine2: "Drive Safe",
    footerIconName: "leaf" as const,
  },

  // Layout Landmark Percentages (per reference specification)
  layout: {
    // Wordmark vertical center: about 49% from the top
    wordmarkTopPercent: 0.49,
    // Tagline: tiny uppercase text just under the wordmark
    taglineTopPercent: 0.548,
    // Footer: icon + two lines at exactly 81.2% down matching reference screenshot
    footerTopPercent: 0.812,
  },

  // Symbol Shape Geometry: Concave Four-Pointed Star
  // ViewBox: 0 0 100 100, Center at (50, 50)
  // Curves strictly concave toward center (50, 50)
  symbol: {
    viewBox: "0 0 100 100",
    center: { x: 50, y: 50 },
    // Standard concave quadratic Bézier astroid
    path: "M 50 0 Q 50 50 100 50 Q 50 50 50 100 Q 50 50 0 50 Q 50 50 50 0 Z",
    tipRadius: 50,
    waistRadius: 17.68,
  },

  // Timeline Landmarks (in seconds from content appearance)
  // Includes an initial 450ms hold so the user clearly sees and reads Sahayak
  timings: {
    T_HOLD: 0.45,              // 0.00 - 0.45s: Brand still hold (Sahayak clearly visible)
    T0_MOTION_START: 0.45,     // 0.45s: Star leaves logo (t_rel = 0.00s)
    T1_WORDMARK_ERASED: 0.58,  // t_rel = 0.13s: Wordmark erased in star's wake
    T2_ALL_ERASED: 0.65,       // t_rel = 0.20s: Tagline erased
    T3_SPIRAL_END: 1.12,       // t_rel = 0.67s: Arrives at centre (49.7%, 49.3%), upright
    T4_STILL_END: 1.29,        // t_rel = 0.84s: Perfectly still at centre (5.2% width)
    T5_SHRINK_END: 1.38,       // t_rel = 0.93s: Anticipation shrink to 2% width
    T6_POP_END: 1.42,          // t_rel = 0.97s: Pops open to 20% width x 23% height
    T7_POP_HOLD_END: 1.45,     // t_rel = 1.00s: 0.03s hold
    T8_HALF_SCREEN: 1.48,      // t_rel = 1.03s: Grows to 51% width x 58% height, brand drops to half opacity
    T9_REVEAL_START: 1.52,     // t_rel = 1.07s: Accelerated scale-up as window mask
    T10_CORNERS_ONLY: 1.58,    // t_rel = 1.13s: Only curved corners still brand colour
    T11_COMPLETE: 1.68,        // t_rel = 1.23s: Corners fully clear, dark status bar, Login screen revealed!
    TOTAL_DURATION: 1.68,
  },
} as const;

export type SplashConfig = typeof splashConfig;
