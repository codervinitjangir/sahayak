import { apiClient } from "./client";

export interface CurrentAssignment {
  id: string;
  partner_id: string;
  partner_name: string;
  partner_phone: string;
  partner_rating: number | null;
  partner_rating_count: number;
  status: string;
  assigned_at: string;
}

export interface BackendJob {
  id: string;
  user_id: string;
  vehicle_id: string;
  service_code: string;
  status:
    | "requested"
    | "matching"
    | "assigned"
    | "partner_en_route"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_match_found";
  pickup_lat: number;
  pickup_lng: number;
  pickup_address_text: string;
  notes?: string | null;
  price_estimate: number;
  price_final?: number | null;
  created_at: string;
  updated_at?: string;
  current_assignment?: CurrentAssignment | null;
  timeline?: Array<{
    status: string;
    note?: string | null;
    timestamp: string;
  }>;
}

export interface BackendPartnerOfferItem {
  assignment_id: string;
  job_id: string;
  service_code: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address_text: string;
  price_estimate: number;
  distance_km: number;
  offered_at: string;
}

export interface AssignmentRespondResponse {
  assignment_id: string;
  job_id: string;
  job_status: string;
}

export interface JobRatingItem {
  id: string;
  job_id: string;
  rater_type: "user" | "partner";
  rated_id: string;
  rating: number;
  comment?: string | null;
  created_at: string;
}

export interface JobRatingsResponse {
  job_id: string;
  ratings: JobRatingItem[];
  can_rate: boolean;
}

export interface CreateJobPayload {
  vehicle_id: string;
  service_code: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address_text: string;
  notes?: string;
}

// ─── Job API calls ────────────────────────────────────────────────────────────

export const jobsApi = {
  /** Create a new roadside assistance job (POST /api/v1/jobs) */
  createJob: (payload: CreateJobPayload, idempotencyKey?: string) =>
    apiClient
      .post<BackendJob>("/jobs", payload, {
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      })
      .then((r) => r.data),

  /** Get job by ID with assignment, partner details and timeline (GET /api/v1/jobs/{jobId}) */
  getJob: (jobId: string) =>
    apiClient.get<BackendJob>(`/jobs/${jobId}`).then((r) => r.data),

  /**
   * Cancel a pending or active job (POST /api/v1/jobs/{jobId}/cancel)
   *
   * The field is `cancellation_reason`, not `reason`. JobCancelRequest sets
   * `extra="forbid"`, so the shorter name was not ignored — it made every cancel
   * a 422 naming the offending field, on a screen whose whole job is to let
   * somebody back out.
   */
  cancelJob: (jobId: string, cancellationReason?: string) =>
    apiClient
      .post<BackendJob>(`/jobs/${jobId}/cancel`, {
        cancellation_reason: cancellationReason,
      })
      .then((r) => r.data),

  /** Partner: respond to assignment offer (POST /api/v1/job-assignments/{assignmentId}/respond) */
  respondToAssignment: (
    assignmentId: string,
    action: "accept" | "reject",
    reason?: string
  ) =>
    apiClient
      .post<AssignmentRespondResponse>(`/job-assignments/${assignmentId}/respond`, {
        action,
        rejection_reason: reason || undefined,
      })
      .then((r) => r.data),

  /** Advance job lifecycle status (POST /api/v1/jobs/{jobId}/status) */
  updateJobStatus: (jobId: string, status: string, priceFinal?: number) =>
    apiClient
      .post<BackendJob>(`/jobs/${jobId}/status`, {
        status,
        ...(status === "completed" && priceFinal !== undefined
          ? { price_final: priceFinal }
          : {}),
      })
      .then((r) => r.data),

  /** Partner: list active incoming offers (GET /api/v1/partners/me/offers) */
  getOffers: () =>
    apiClient
      .get<BackendPartnerOfferItem[]>("/partners/me/offers", {
        // Suppress console warnings during periodic background polling when server is offline
        silent: true,
      } as any)
      .then((r) => r.data)
      .catch(() => []),

  /** Get job ratings and whether caller can rate (GET /api/v1/jobs/{jobId}/ratings) */
  getRatings: (jobId: string) =>
    apiClient.get<JobRatingsResponse>(`/jobs/${jobId}/ratings`).then((r) => r.data),

  /** Submit rating for completed job (POST /api/v1/jobs/{jobId}/ratings) */
  submitRating: (jobId: string, rating: number, comment?: string) =>
    apiClient
      .post(`/jobs/${jobId}/ratings`, { rating, comment: comment || undefined })
      .then((r) => r.data),
};

// Removed 2026-10-06: listMyJobs() called GET /jobs/me, which does not exist —
// there is no job-history route on the backend for either role, and asking for one
// is tracked in BACKEND_COMMUNICATION.md §3.1. Until it ships, a history screen
// has nothing to call; leaving the method here only meant the 404 was found by a
// user rather than by this file.
