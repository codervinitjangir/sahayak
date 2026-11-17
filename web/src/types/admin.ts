/**
 * Admin analytics payload types — `GET /api/v1/admin/analytics/{overview,dispatch,matching}`.
 *
 * Mirrors `backend/app/schemas/analytics.py` field for field. Numbers the backend
 * types as `Decimal` arrive as JSON strings, so every one of those is
 * `number | string | null` here and goes through `num()` before arithmetic —
 * `Number(null)` is 0, which would silently plot a missing value as zero.
 */

/** A caveat the backend attaches to its own figures. Render these verbatim. */
export interface AnalyticsNote {
  code: string;
  detail: string;
}

export interface WindowInfo {
  requested_from: string | null;
  requested_to: string | null;
  first_job_at: string | null;
  last_job_at: string | null;
}

export interface DurationStats {
  count: number;
  mean: number | string | null;
  min: number | string | null;
  p50: number | string | null;
  p95: number | string | null;
  max: number | string | null;
  unit: string;
}

export interface JobsByStatus {
  total: number;
  requested: number;
  matching: number;
  assigned: number;
  partner_en_route: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  no_match_found: number;
}

export interface ConversionStats {
  completed: number;
  total: number;
  still_open: number;
  rate: number | null;
}

export interface PartnerSupply {
  partners_total: number;
  verified: number;
  available_now: number;
  dispatchable_now: number;
  busy_now: number;
  live_assignments: number;
  rated: number;
  ratings_total: number;
  mean_rating: number | string | null;
}

export interface AnalyticsOverview {
  window: WindowInfo;
  jobs: JobsByStatus;
  conversion: ConversionStats;
  partners: PartnerSupply;
  work_started: DurationStats;
  /** Always null: nothing has ever written an arrival estimate. See ADR-021. */
  eta_accuracy: null;
  notes: AnalyticsNote[];
}

export interface OfferOutcomes {
  total: number;
  accepted: number;
  declined: number;
  /** Offers the dispatch worker timed out after 60 s (ADR-032). Not declines. */
  timed_out: number;
  unanswered: number;
  jobs_offered: number;
  partners_offered: number;
  acceptance_rate_of_answered: number | null;
  acceptance_rate_of_all: number | null;
}

export interface OffersBeforeAcceptance {
  accepted_offers: number;
  mean_rank: number | string | null;
  at_rank_1: number;
  at_rank_2: number;
  at_rank_3_or_worse: number;
  worst_rank: number | null;
}

export interface NoMatchStats {
  total: number;
  genuine: number;
  dispatch_unavailable: number;
  jobs_in_window: number;
  rate: number | null;
  rate_including_outages: number | null;
}

export interface AnalyticsDispatch {
  window: WindowInfo;
  dispatch_latency: DurationStats;
  offers: OfferOutcomes;
  offers_before_acceptance: OffersBeforeAcceptance;
  no_match: NoMatchStats;
  notes: AnalyticsNote[];
}

export interface DivergenceStats {
  first_offers: number;
  diverged: number;
  agreed_with_nearest: number;
  rate: number | null;
}

export interface StrategyArm {
  offers: number;
  answered: number;
  accepted: number;
  acceptance_rate: number | null;
  mean_matching_score: number | string | null;
  mean_distance_score: number | string | null;
  mean_load_score: number | string | null;
  mean_skill_score: number | string | null;
  mean_rating_score: number | string | null;
}

export interface ComponentAttribution {
  diverged_offers: number;
  deltas: Record<string, number | string | null>;
  stddev: Record<string, number | string | null>;
  /** Components that varied, and so could have driven the choice. */
  eligible_components: string[];
  /** Components constant across the window — excluded from `driver` by design. */
  constant_components: string[];
  driver: string | null;
}

export interface AnalyticsMatching {
  window: WindowInfo;
  divergence: DivergenceStats;
  weighted_diverged: StrategyArm;
  also_nearest: StrategyArm;
  attribution: ComponentAttribution;
  notes: AnalyticsNote[];
}

/** The half-open window every report accepts. Both bounds optional. */
export interface AnalyticsWindowParams {
  /** Inclusive lower bound, ISO 8601. Sent as `from`. */
  from?: string;
  /** Exclusive upper bound, ISO 8601. Sent as `to`. */
  to?: string;
}

/**
 * A backend Decimal-as-string, or a real number, or nothing.
 *
 * Returns null rather than 0 for absent values. `Number(null)` is 0, and a
 * duration of "no data" plotted as zero is a chart that lies — the p95 of an
 * empty set is not instantaneous.
 */
export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
