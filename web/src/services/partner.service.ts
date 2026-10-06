import { apiClient } from './api';
import { jobsService } from './jobs.service';
import * as mock from './partner.mock';
import { getStoredPartnerProfile } from '../types/partner';
import type { Job, JobStatus } from '../types/jobs';
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
 * Not yet built on the backend (mock-only until a backend decision):
 *   getEarnings()   — no /partners/me/earnings endpoint. No payments data in
 *                     the backend at all. Screens that depend on this:
 *                     ConsoleSettings earnings card, PartnerDashboard stats block.
 *
 * VITE_PARTNER_API_MOCK controls the mock branch:
 *   - false (default): real API calls for the six shipped endpoints above.
 *   - true (explicit opt-in): mock for all calls, including earnings,
 *     which has no real path. Set this if you need to demo earnings
 *     UI without a backend decision on that endpoint.
 *
 * Note: earnings always falls back to mock regardless of this flag,
 * because no real endpoint exists for it.
 */

/**
 * Mock switch.
 *
 * Defaults to false — real API calls are made for the shipped endpoints:
 *   GET   /partners/me/offers           → getPendingOffer()
 *   POST  /job-assignments/{id}/respond → acceptOffer() / rejectOffer()
 *   PATCH /partners/{id}/availability  → setAvailability()
 *   POST  /partners/{id}/location      → reportLocation()
 *   GET   /partners/me/jobs/active      → getActiveJob()
 *   GET   /partners/me/stats            → getTrustStats()
 *
 * Set VITE_PARTNER_API_MOCK=true in .env to explicitly opt in to mock behavior.
 *
 * Note: getEarnings() always uses mock data regardless of this flag because
 * its backend endpoint does not exist yet (payments deferred).
 */
export const IS_PARTNER_API_MOCK = import.meta.env.VITE_PARTNER_API_MOCK === 'true';

/** Enough latency for loading states to be real, none of it in the test run. */
const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 150;

function settle<T>(value: T): Promise<T> {
  if (MOCK_LATENCY_MS === 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

/** Mock errors must reject, not throw synchronously, to match the real client. */
function settleWith<T>(produce: () => T): Promise<T> {
  try {
    return settle(produce());
  } catch (error) {
    return Promise.reject(error);
  }
}

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
  distance_at_offer_m: string;     // Decimal string — parse before arithmetic
  estimated_arrival_min: number;
  assignment_rank: number;
  job: {
    status: string;
    service_code: string | null;
    service_name: string | null;
    vehicle_number: string | null;
    pickup_address_text: string | null;
    issue_description: string | null;
    price_estimate: string | null;  // Decimal string — parse before arithmetic
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

export const partnerService = {
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
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getPendingOffer());

    const res = await apiClient<PartnerOfferItem[]>('/partners/me/offers', { method: 'GET' });
    const items = res.data;
    if (!items || items.length === 0) return null;

    // Normalize the wire shape to the internal PartnerOffer shape used by the UI.
    const item = items[0];
    const offer: PartnerOffer = {
      // The UI currently calls this field `id`, but on the wire it is `assignment_id`.
      // We surface assignment_id as the primary key — call sites should use this
      // when calling acceptOffer() / rejectOffer().
      id: item.assignment_id,
      jobId: item.job_id,
      serviceCode: item.job.service_code ?? '',
      serviceName: item.job.service_name ?? '',
      distanceAtOfferM: parseFloat(item.distance_at_offer_m),
      pickupAddressText: item.job.pickup_address_text ?? '',
      vehicleNumber: item.job.vehicle_number ?? '',
      issueDescription: item.job.issue_description ?? '',
      offeredAt: item.offered_at,
      payoutEstimate: item.job.price_estimate != null
        ? parseFloat(item.job.price_estimate)
        : undefined,
    };
    return offer;
  },

  /**
   * Accept an outstanding offer.
   *
   * Real path: POST /job-assignments/{assignment_id}/respond
   * Body: { "action": "accept" }
   *
   * IMPORTANT — return type: the respond endpoint returns
   * { assignment_status, job_status }, NOT a full Job object. To get the full
   * job, call getJob(jobId) with the job_id from the offer that was accepted.
   *
   * The `assignmentId` parameter is the value from PartnerOffer.id (which maps
   * to assignment_id on the wire from GET /partners/me/offers). The name
   * `offerId` was kept for backward compatibility with call sites, but it
   * must be the assignment_id, not a job_id.
   *
   * Rejects with ApiError status 409 ASSIGNMENT_ALREADY_ANSWERED when the
   * offer was taken by someone else, or the owner cancelled underneath.
   * Rejects with ApiError status 409 PARTNER_AT_CAPACITY when the partner is
   * already at the maximum concurrent-job limit.
   */
  async acceptOffer(offerId: string): Promise<AssignmentRespondResponse> {
    if (IS_PARTNER_API_MOCK) {
      const job = await settleWith(() => mock.acceptOffer(offerId));
      // Wrap mock's Job return in the real response shape for consistent call sites.
      return {
        assignment_id: offerId,
        assignment_status: 'accepted' as const,
        job_id: job.id,
        job_status: job.status,
      };
    }

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
   *
   * Declining is never an error — an offer that already vanished is still
   * safe to call reject on (409 ASSIGNMENT_ALREADY_ANSWERED, treat as
   * success: the offer is gone either way).
   */
  async rejectOffer(offerId: string, reason?: string): Promise<void> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.rejectOffer(offerId));

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
   *
   * Returns the partner's active job (status in 'assigned', 'partner_en_route',
   * 'in_progress' where this partner holds an 'accepted' assignment), or null
   * if the partner is currently idle.
   *
   * Reuses the full job detail representation with PII/contact details released
   * to the assigned partner, enabling cold-refresh recovery on the active-job screen.
   */
  async getActiveJob(): Promise<Job | null> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getActiveJob());

    const res = await apiClient<Job | null>('/partners/me/jobs/active', { method: 'GET' });
    return res.data;
  },

  async getJob(jobId: string): Promise<Job | null> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getJob(jobId));

    return jobsService.getJob(jobId);
  },

  /**
   * Advances the job. Delegates to jobsService so there is exactly one place
   * that knows the endpoint shape once the mock is switched off.
   */
  async updateJobStatus(jobId: string, status: JobStatus): Promise<Job> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.updateJobStatus(jobId, status));

    return jobsService.updateJobStatus(jobId, status);
  },

  /**
   * Toggle on/off shift for this partner.
   *
   * Real path: PATCH /partners/{partner_id}/availability
   * Body: { "is_available": bool }
   *
   * The partner_id is read from the stored partner profile (PartnerProfile.id),
   * which is populated from POST /partners (registration) or
   * POST /partners/{id}/link-auth, and persisted to localStorage via
   * getStoredPartnerProfile(). In demo mode this is `ptr_ramesh_01` (seeded).
   *
   * If the partner has not yet completed registration (no stored profile id),
   * the real call is a no-op and the mock branch will be used instead. This
   * handles the demo/dev case and the rare edge case where registration was
   * interrupted before saving the profile.
   */
  async setAvailability(isAvailable: boolean): Promise<void> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.setAvailability(isAvailable));

    const profile = getStoredPartnerProfile();
    const partnerId = profile.id;

    if (!partnerId) {
      // Partner has not completed registration — their id was never stored.
      // This should not happen in a real build; flag it clearly.
      console.warn(
        '[partner.service] setAvailability: no partner_id in stored profile. ' +
        'Registration may be incomplete. Falling back to mock.'
      );
      return settleWith(() => mock.setAvailability(isAvailable));
    }

    await apiClient<void>(`/partners/${partnerId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ is_available: isAvailable }),
    });
  },

  /**
   * Report partner's current GPS coordinates to Redis GEO.
   *
   * Real path: POST /partners/{partner_id}/location
   * Body: { "lat": number, "lng": number }
   *
   * Coordinates are stored in Redis only (not Postgres). Live dispatch uses
   * Redis GEOSEARCH to discover nearby available partners.
   */
  async reportLocation(
    lat: number,
    lng: number
  ): Promise<{ partner_id: string; recorded_at: string } | null> {
    if (IS_PARTNER_API_MOCK) {
      return settleWith(() => ({
        partner_id: 'mock',
        recorded_at: new Date().toISOString(),
      }));
    }

    const profile = getStoredPartnerProfile();
    const partnerId = profile.id;

    if (!partnerId) {
      console.warn(
        '[partner.service] reportLocation: no partner_id in stored profile. Falling back to mock.'
      );
      return settleWith(() => ({
        partner_id: 'mock',
        recorded_at: new Date().toISOString(),
      }));
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
   * ⚠️  BACKEND GAP — earnings endpoint does not exist.
   *
   * GET /partners/me/earnings is not in the backend route inventory.
   * There is no payments data in the backend at all today (FRONTEND-GUIDE §1.5,
   * §5.4). Screens that depend on this: earnings card in ConsoleSettings,
   * stats block in PartnerDashboard.
   *
   * This function ALWAYS uses the mock, regardless of IS_PARTNER_API_MOCK.
   * It will continue to do so until a backend endpoint is built and a new
   * section is added to HANDOFF-frontend-contract.md.
   *
   * Do not remove the mock fallback or add a real fetch path here — a fake
   * success response for an endpoint that doesn't exist is worse than an
   * explicit "not built" state.
   */
  async getEarnings(window: EarningsWindow): Promise<PartnerEarnings> {
    // Always mock — no real endpoint. See comment above.
    return settleWith(() => mock.getEarnings(window));
  },

  /**
   * Get caller's trust and performance statistics.
   *
   * Real path: GET /partners/me/stats (shipped 2026-10-06).
   *
   * Exposes rating_avg, rating_count, verification_status from the partner
   * profile, and aggregated acceptance_rate_pct and lifetime_jobs from
   * historical job_assignments.
   */
  async getTrustStats(): Promise<PartnerTrustStats> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getTrustStats());

    const res = await apiClient<{
      partner_id: string;
      verification_status: string;
      rating_avg: number | string;
      rating_count: number;
      acceptance_rate_pct: number;
      lifetime_jobs: number;
    }>('/partners/me/stats', {
      method: 'GET',
    });

    const data = res.data;
    return {
      acceptanceRatePct: data.acceptance_rate_pct,
      ratingAvg: Number(data.rating_avg) || 0,
      ratingCount: data.rating_count,
      lifetimeJobs: data.lifetime_jobs,
    };
  },

  /**
   * Demo affordance only — there is no way to make the real dispatcher send an
   * offer on request. The dashboard hides the control when not mocking.
   */
  async simulateIncomingOffer(): Promise<PartnerOffer | null> {
    if (!IS_PARTNER_API_MOCK) return null;
    return settleWith(() => mock.issueOffer());
  },
};
