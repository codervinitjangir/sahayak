import { apiClient } from './api';
import { jobsService } from './jobs.service';
import { getStoredPartnerProfile } from '../types/partner';
import type { Job, JobStatus, JobStatusTransitionResponse } from '../types/jobs';
import type {
  EarningsWindow,
  PartnerEarnings,
  PartnerOffer,
  PartnerTrustStats,
} from '../types/partner';

/**
 * Partner dispatch API.
 *
 * Real endpoints (shipped as of 2026-10-06):
 *   GET   /partners/me/offers           → getPendingOffer()
 *   POST  /job-assignments/{id}/respond → acceptOffer() / rejectOffer()
 *   PATCH /partners/{id}/availability  → setAvailability()
 *   POST  /partners/{id}/location      → reportLocation()
 *   GET   /partners/me/jobs/active      → getActiveJob()
 *   GET   /partners/me/stats            → getTrustStats()
 *
 * Backend gap:
 *   getEarnings() — no /partners/me/earnings endpoint exists yet (payments deferred).
 *   Returns honest zero values rather than fabricated figures.
 */

/**
 * Shape returned by GET /partners/me/offers (one item in the data array).
 * The field name on the wire is `assignment_id` — this is what you pass to
 * acceptOffer() and rejectOffer(). It is NOT an "offer id"; it is the
 * assignment_id that /job-assignments/{assignment_id}/respond expects.
 */
export interface PartnerOfferItem {
  assignment_id: string;
  job_id: string;
  offered_at: string;
  /** offered_at + 60 s (ADR-032). Optional so an older backend still parses. */
  expires_at?: string | null;
  distance_at_offer_m: string; // Decimal string — parse before arithmetic
  estimated_arrival_min: number;
  assignment_rank: number;
  job: {
    status: string;
    service_code: string | null;
    service_name: string | null;
    vehicle_number: string | null;
    pickup_address_text: string | null;
    issue_description: string | null;
    price_estimate: string | null; // Decimal string — parse before arithmetic
    requested_at: string;
  };
}

/** Shape returned by POST /job-assignments/{id}/respond */
export interface AssignmentRespondResponse {
  assignment_id: string;
  assignment_status: 'accepted' | 'rejected';
  job_id: string;
  job_status: string;
  responded_at?: string;
  /** Present on reject only — the offer that was passed to the following partner. */
  next_assignment_id?: string | null;
}

export interface PartnerReview {
  job_id: string;
  service_name: string;
  rating: number;
  comment: string | null;
  owner_display_name: string;
  created_at: string;
}

export const partnerService = {
  /** DELETE /partners/me (ADR-045). 409 ACCOUNT_HAS_ACTIVE_JOB while a job or offer is open. */
  async deleteMe(): Promise<void> {
    await apiClient<{ deleted: boolean }>('/partners/me', { method: 'DELETE' });
  },

  /** GET /partners/me/export: everything Sahayak stores about the partner. */
  async exportMe(): Promise<Record<string, unknown>> {
    return (await apiClient<Record<string, unknown>>('/partners/me/export', { method: 'GET' })).data;
  },

  /**
   * Returns the first 'offered' assignment for this partner, or null if idle.
   *
   * Real path: GET /partners/me/offers (returns a list, newest first).
   * By design at most one offer should be in 'offered' state per partner at
   * any given moment (the dispatch engine serialises offers), but the list
   * model is more robust: we take the first item and treat an empty list as
   * "no pending offer", not as an error.
   *
   * The returned object exposes `assignment_id` (not `id`), which is what
   * acceptOffer() and rejectOffer() expect.
   */
  async getPendingOffer(): Promise<PartnerOffer | null> {
    const res = await apiClient<PartnerOfferItem[]>('/partners/me/offers', { method: 'GET' });
    const items = res.data;
    if (!items || items.length === 0) return null;

    // Normalize the wire shape to the internal PartnerOffer shape used by the UI.
    const item = items[0];
    const offer: PartnerOffer = {
      id: item.assignment_id,
      jobId: item.job_id,
      serviceCode: item.job.service_code ?? '',
      serviceName: item.job.service_name ?? '',
      distanceAtOfferM: parseFloat(item.distance_at_offer_m),
      pickupAddressText: item.job.pickup_address_text ?? '',
      vehicleNumber: item.job.vehicle_number ?? '',
      issueDescription: item.job.issue_description ?? '',
      offeredAt: item.offered_at,
      expiresAt: item.expires_at ?? undefined,
      payoutEstimate:
        item.job.price_estimate != null ? parseFloat(item.job.price_estimate) : undefined,
    };
    return offer;
  },

  /**
   * Accept an outstanding offer.
   *
   * Real path: POST /job-assignments/{assignment_id}/respond
   * Body: { "action": "accept" }
   *
   * Returns AssignmentRespondResponse.
   */
  async acceptOffer(offerId: string): Promise<AssignmentRespondResponse> {
    const res = await apiClient<AssignmentRespondResponse>(
      `/job-assignments/${offerId}/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
      }
    );
    return res.data;
  },

  /**
   * Reject an outstanding offer.
   *
   * Real path: POST /job-assignments/{assignment_id}/respond
   * Body: { "action": "reject", "rejection_reason": reason (optional) }
   */
  async rejectOffer(offerId: string, reason?: string): Promise<void> {
    await apiClient<AssignmentRespondResponse>(`/job-assignments/${offerId}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'reject',
        ...(reason !== undefined ? { rejection_reason: reason } : {}),
      }),
    });
  },

  /**
   * Get the partner's current active job.
   *
   * Real path: GET /partners/me/jobs/active (shipped 2026-10-06).
   */
  async getActiveJob(): Promise<Job | null> {
    const res = await apiClient<Job | null>('/partners/me/jobs/active', { method: 'GET' });
    return res.data;
  },

  async getJob(jobId: string): Promise<Job | null> {
    return jobsService.getJob(jobId);
  },

  /**
   * Advances the job. Delegates to jobsService.
   */
  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    extra?: { price_final?: number; cancellation_reason?: string }
  ): Promise<JobStatusTransitionResponse> {
    return jobsService.updateJobStatus(jobId, status, extra);
  },

  /** Verify the owner's start code — POST /jobs/{id}/start. */
  async startJob(jobId: string, startCode: string): Promise<JobStatusTransitionResponse> {
    return jobsService.startJob(jobId, startCode);
  },

  /**
   * Toggle on/off shift for this partner.
   *
   * Real path: PATCH /partners/{partner_id}/availability
   * Body: { "is_available": bool }
   */
  async setAvailability(isAvailable: boolean, explicitPartnerId?: string): Promise<{ id: string; is_available: boolean; updated_at: string }> {
    const partnerId = explicitPartnerId || getStoredPartnerProfile().id;

    if (!partnerId) {
      throw new Error('[partner.service] setAvailability: no partner_id provided or found in stored profile.');
    }

    const res = await apiClient<{ id: string; is_available: boolean; updated_at: string }>(
      `/partners/${partnerId}/availability`,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_available: isAvailable }),
      }
    );
    return res.data;
  },

  /**
   * Report partner's current GPS coordinates to Redis GEO.
   *
   * Real path: POST /partners/{partner_id}/location
   * Body: { "lat": number, "lng": number }
   */
  async reportLocation(
    lat: number,
    lng: number,
    explicitPartnerId?: string
  ): Promise<{ partner_id: string; recorded_at: string }> {
    const partnerId = explicitPartnerId || getStoredPartnerProfile().id;

    if (!partnerId) {
      throw new Error('[partner.service] reportLocation: no partner_id provided or found in stored profile.');
    }

    const res = await apiClient<{ partner_id: string; recorded_at: string }>(
      `/partners/${partnerId}/location`,
      {
        method: 'POST',
        body: JSON.stringify({ lat, lng }),
      }
    );
    return res.data;
  },

  /**
   * ⚠️ BACKEND GAP — earnings endpoint does not exist.
   *
   * GET /partners/me/earnings is not in the backend route inventory.
   * There is no payments data in the backend at all today (FRONTEND-GUIDE §1.5, §5.4).
   * Returns honest zeros instead of fabricated numbers (Rule A).
   */
  async getEarnings(window: EarningsWindow): Promise<PartnerEarnings> {
    return Promise.resolve({
      window,
      jobsCompleted: 0,
      amountEarned: 0,
      previousAmountEarned: 0,
    });
  },

  /**
   * Get caller's trust and performance statistics.
   *
   * Real path: GET /partners/me/stats (shipped 2026-10-06).
   */
  /** The services this partner is linked to (GET /partners/me/services). */
  async getMyServices(): Promise<Array<{ service_id: number; code: string; name: string }>> {
    const res = await apiClient<{
      partner_id: string;
      services: Array<{ service_id: number; code: string; name: string }>;
    }>('/partners/me/services', { method: 'GET' });
    return res.data.services ?? [];
  },

  /** Each owner rating behind the average, newest first. Owner = first name + initial. */
  async getReviews(limit = 100, offset = 0): Promise<PartnerReview[]> {
    const res = await apiClient<{ items: PartnerReview[] }>(
      `/partners/me/reviews?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    );
    return res.data.items ?? [];
  },

  async getTrustStats(): Promise<PartnerTrustStats> {
    const res = await apiClient<{
      partner_id: string;
      verification_status: string;
      is_available?: boolean;
      rating_avg: number | string;
      rating_count: number;
      acceptance_rate_pct: number;
      lifetime_jobs: number;
    }>('/partners/me/stats', {
      method: 'GET',
    });

    const data = res.data;
    return {
      partnerId: data.partner_id,
      verificationStatus: data.verification_status,
      isAvailable: data.is_available,
      acceptanceRatePct: data.acceptance_rate_pct,
      ratingAvg: Number(data.rating_avg) || 0,
      ratingCount: data.rating_count,
      lifetimeJobs: data.lifetime_jobs,
    };
  },

  /**
   * Link or update the service codes this partner offers.
   *
   * Real path: POST /partners/{partner_id}/services
   */
  async updateServices(partnerId: string, serviceCodes: string[]): Promise<{ partner_id: string; services: Array<{ service_id: number; code: string; name: string }> }> {
    const res = await apiClient<{ partner_id: string; services: Array<{ service_id: number; code: string; name: string }> }>(
      `/partners/${partnerId}/services`,
      {
        method: 'POST',
        body: JSON.stringify({ service_codes: serviceCodes }),
      }
    );
    return res.data;
  },

  /**
   * Registers a partner via POST /partners.
   */
  async registerPartner(payload: {
    name: string;
    phone: string;
    primary_category_code?: string;
  }): Promise<{
    id: string;
    name: string;
    phone: string;
    is_available: boolean;
    verification_status: string;
    created_at: string;
    updated_at: string;
  }> {
    const res = await apiClient<{
      id: string;
      name: string;
      phone: string;
      is_available: boolean;
      verification_status: string;
      created_at: string;
      updated_at: string;
    }>('/partners', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  /**
   * Links authenticated Supabase identity to this partner profile.
   * Real path: POST /partners/{partner_id}/link-auth
   */
  async linkAuth(partnerId: string): Promise<{
    id: string;
    auth_user_id: string;
    verification_status: string;
  }> {
    const res = await apiClient<{
      id: string;
      auth_user_id: string;
      verification_status: string;
    }>(`/partners/${partnerId}/link-auth`, {
      method: 'POST',
    });
    return res.data;
  },
};

