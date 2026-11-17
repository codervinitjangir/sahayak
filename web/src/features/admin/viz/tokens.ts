/**
 * Chart tokens for the admin console.
 *
 * ## These values were computed, not chosen
 *
 * Every colour below was run through the data-viz validator against **Sahayak's
 * own surface** (`#FFFFFF`, not a generic off-white), and the first attempt
 * failed:
 *
 *   #0F766E (brand-700, the primary token)  →  FAIL, chroma 0.086 < 0.1 floor
 *
 * The primary brand teal is too desaturated to serve as a chart fill — it reads
 * gray next to another series. Snapping to the next step up its own ramp fixes it:
 *
 *   #0D9488 (brand-600) + #eb6834 + #4a3aa7
 *     Lightness band      PASS   all inside L 0.43–0.77
 *     Chroma floor        PASS   all >= 0.1
 *     CVD separation      PASS   worst all-pairs ΔE 10.7 (protan), 19.9 (tritan)
 *     Normal-vision floor PASS   worst all-pairs ΔE 26.8
 *     Contrast vs surface PASS   all >= 3:1
 *
 * Validated under `--pairs all`, not merely adjacent, because a three-segment
 * stacked bar puts every pair next to some other pair. Re-run before changing any
 * hex here:
 *
 *   node scripts/validate_palette.js "#0D9488,#eb6834,#4a3aa7" \
 *        --mode light --surface "#FFFFFF" --pairs all
 *
 * ## Why only three categorical slots
 *
 * Nothing in this console needs a fourth. The widest chart is the strategy
 * comparison (two arms) and the widest stack is offer outcomes (three states).
 * A fourth slot would put yellow beside orange, which fails the all-pairs floors —
 * so if a chart here ever wants more series, the answer is small multiples or an
 * "other" bucket, never a generated hue.
 *
 * ## No dark mode
 *
 * The app has no dark theme — `tailwind.config.js` sets no `darkMode`, and no
 * surface in it is dark. Shipping dark steps nobody can select would be dead
 * tokens. If a dark theme lands, these get re-stepped for the dark surface and
 * re-validated; an automatic inversion is not a dark palette.
 */

/** Categorical identity — fixed order, never cycled, never assigned by rank. */
export const SERIES = {
  /** Slot 1. Sahayak brand-600. The weighted engine, the primary subject. */
  one: '#0D9488',
  /** Slot 2. The thing slot 1 is compared against. */
  two: '#eb6834',
  /** Slot 3. Third state in a part-to-whole stack. */
  three: '#4a3aa7',
  /**
   * Slot 4. A neutral "nothing happened" state (an offer that timed out,
   * ADR-032). Slate, so it reads as absence rather than as a fourth outcome
   * competing with the three hues above.
   */
  four: '#94A3B8',
} as const;

/**
 * Diverging poles for signed values (component deltas), with a neutral gray
 * midpoint. Teal↔red: warm against cool, so they read as opposite, and the
 * midpoint reads as "nothing" rather than as a third category. Validated
 * all-pairs on #FFFFFF: CVD ΔE 11.9, normal-vision 29.1, both >= 3:1.
 */
export const DIVERGING = {
  positive: '#0D9488',
  negative: '#e34948',
  /** Must be gray. A hue here would turn "no difference" into a category. */
  midpoint: '#E2E8F0',
} as const;

/**
 * An ordered ramp for ordinal bins (offer rank 1 / 2 / 3+). One hue, light→dark,
 * so position in the ramp carries position in the order.
 *
 * The first attempt here — brand-200/500/700 — **failed**, and it is worth
 * recording why rather than just fixing it:
 *
 *   #5EEAD4 at 1.48:1 vs #FFFFFF  →  FAIL, below the 2:1 ordinal floor
 *
 * A *sequential* ramp may recede toward the surface at "near zero"; an **ordinal**
 * one may not, because every bin is a real category someone has to see. Rank-1
 * acceptances are the most common bin in a healthy system, so the invisible bar
 * would have been the important one. Re-stepped to brand-500/600/800:
 *
 *   #14B8A6,#0D9488,#115E59 --ordinal
 *     Lightness monotone PASS · adjacent ΔL PASS · light end 2.49:1 PASS · single hue PASS (6°)
 */
export const ORDINAL = ['#14B8A6', '#0D9488', '#115E59'] as const;

/** Chart chrome. Recessive by construction: the data is the only loud thing. */
export const CHROME = {
  surface: '#FFFFFF',
  plane: '#F8FAFC',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  /** Hairline, solid — never dashed. Dashes read as "threshold". */
  grid: '#E2E8F0',
  axis: '#CBD5E1',
  /** The track behind a meter: a lighter step of the fill's own ramp. */
  track: '#F1F5F9',
} as const;

/**
 * Status colours, from Sahayak's own `status` tokens. Reserved for state —
 * never reused as "series 4" — and always shipped with an icon and a label, so
 * colour never carries the meaning alone.
 */
export const STATUS = {
  good: '#15803D',
  warning: '#B45309',
  critical: '#B91C1C',
  info: '#0284C7',
} as const;

/** The 2px gap, in the surface colour, that separates touching marks. */
export const MARK_GAP_PX = 2;

/** Bars never fill their band; the leftover is air. */
export const MAX_BAR_PX = 24;

/**
 * Compact a count for a stat tile: 1,284 / 12.9K / 3.4M.
 *
 * Proportional figures, not `tabular-nums` — equal-width digits make a number
 * like 121 look loose at display size. Tabular is for table columns only.
 */
export function compact(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-IN');
}

/** A rate in 0..1 as a percentage string, or an em dash when absent. */
export function pct(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** A duration, with its unit, or an em dash. Never 0 for "no data". */
export function dur(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${unit}`;
}

/** Ink that clears contrast against a filled mark, for in-segment labels. */
export function inkOn(fill: string): string {
  const hex = fill.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Rec. 709 relative luminance, enough to pick white-or-ink.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? CHROME.textPrimary : '#FFFFFF';
}

/** Turn a snake_case component key into a readable label. */
export function humanise(key: string): string {
  return key
    .replace(/^mean_/, '')
    .replace(/_score$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
