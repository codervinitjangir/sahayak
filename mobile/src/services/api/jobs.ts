import { apiClient } from "./client";

export interface CurrentAssignment {
  status: string;
  partner_id?: string | null;
  partner_name?: string | null;
  partner_phone?: string | null;
  partner_rating?: number | null;
  partner_rating_count?: number | null;
  estimated_arrival_min?: number | null;
}

export interface BackendJob {
  id: string;
  user_id: string;
  vehicle_id?: string | null;
  vehicle_number?: string | null;
  service_code?: string | null;
  service_name?: string | null;
  status:
    | "requested"
    | "matching"
    | "assigned"
    | "partner_en_route"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_match_found";
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_address_text: string;
  issue_description?: string | null;
  price_estimate: number;
  price_final?: number | null;
  created_at?: string;
  requested_at?: string;
  updated_at?: string;
  owner_name?: string | null;
  owner_phone?: string | null;
  /** History rows only: the partner for an owner, the owner for a partner. */
  counterpart_name?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  cancellation_reason?: string | null;
  /** Owner-only. Partners prove the code through POST /jobs/{id}/start. */
  start_code?: string | null;
  /** Owner-only. Required as ?t= on the public /track link. */
  share_token?: string | null;
  current_assignment?: CurrentAssignment | null;
  timeline?: Array<{
    status: string;
    note?: string | null;
    timestamp: string;
  }>;
}

export interface BackendPartnerOfferJob {
  status: string;
  service_code: string | null;
  service_name: string | null;
  vehicle_number: string | null;
  pickup_address_text: string | null;
  issue_description: string | null;
  price_estimate: number | null;
  requested_at: string;
}

export interface BackendPartnerOfferItem {
  assignment_id: string;
  job_id: string;
  offered_at: string;
  distance_at_offer_m: number | null;
  estimated_arrival_min: number | null;
  assignment_rank: number | null;
  job: BackendPartnerOfferJob;
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
  issue_description?: string;
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

  /**
   * Partner: verify the owner's 4-digit code and begin work
   * (POST /api/v1/jobs/{jobId}/start)
   *
   * Separate from updateJobStatus because that route cannot reach in_progress
   * without proof of presence. A wrong code is a 400 INVALID_START_CODE.
   */
  startJob: (jobId: string, startCode: string) =>
    apiClient
      .post<BackendJob>(`/jobs/${jobId}/start`, { start_code: startCode })
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

  /** Get real-time partner location (GET /api/v1/jobs/{jobId}/partner-location) */
  getPartnerLocation: (jobId: string) =>
    apiClient
      .get<{
        partner_id?: string | null;
        status: string;
        latitude?: number | null;
        longitude?: number | null;
        updated_at?: string | null;
      }>(`/jobs/${jobId}/partner-location`)
      .then((r) => r.data),

  /** Get public trip tracking for family (GET /api/v1/jobs/{jobId}/public-tracking) */
  getPublicTracking: (jobId: string) =>
    apiClient
      .get<{
        id: string;
        status: string;
        service_name?: string | null;
        vehicle_number?: string | null;
        pickup_address_text?: string | null;
        pickup_lat?: number | null;
        pickup_lng?: number | null;
        partner_name?: string | null;
        partner_rating?: number | null;
        partner_rating_count: number;
        partner_lat?: number | null;
        partner_lng?: number | null;
        partner_location_updated_at?: string | null;
        estimated_arrival_min?: number | null;
        emergency_helpline: string;
        sos_number: string;
        requested_at: string;
        completed_at?: string | null;
      }>(`/jobs/${jobId}/public-tracking`)
      .then((r) => r.data),

  /** Submit rating for completed job (POST /api/v1/jobs/{jobId}/ratings) */
  submitRating: (jobId: string, rating: number, comment?: string) =>
    apiClient
      .post(`/jobs/${jobId}/ratings`, { rating, comment: comment || undefined })
      .then((r) => r.data),

  /**
   * Same endpoint as listMyJobs but errors reach the caller. A screen that shows
   * "no requests yet" has to be able to tell an empty history from a failed one.
   */
  fetchMyJobs: (limit: number = 50, offset: number = 0) =>
    apiClient
      .get<{ items: BackendJob[]; total: number; limit: number; offset: number; has_more: boolean }>(
        `/jobs?limit=${limit}&offset=${offset}`
      )
      .then((r) => r.data),

  /** List caller's jobs history (GET /api/v1/jobs) */
  listMyJobs: (limit: number = 20, offset: number = 0) =>
    apiClient
      .get<{ items: BackendJob[]; total: number; limit: number; offset: number; has_more: boolean }>(
        `/jobs?limit=${limit}&offset=${offset}`
      )
      .then((r) => r.data)
      .catch(() => ({ items: [], total: 0, limit, offset, has_more: false })),
};

