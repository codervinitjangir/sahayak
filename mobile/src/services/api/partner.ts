import { apiClient } from "./client";
import type { BackendJob } from "./jobs";

export interface MobilePartnerTrustStats {
  partner_id: string;
  verification_status: string;
  rating_avg: number;
  rating_count: number;
  acceptance_rate_pct: number;
  lifetime_jobs: number;
}

export const partnerApi = {
  /** Fetch partner performance and trust stats (GET /api/v1/partners/me/stats) */
  getStats: () =>
    apiClient
      .get<MobilePartnerTrustStats>("/partners/me/stats")
      .then((r) => r.data),

  /** Fetch active job if partner has accepted one (GET /api/v1/partners/me/jobs/active) */
  getActiveJob: () =>
    apiClient
      .get<BackendJob | null>("/partners/me/jobs/active")
      .then((r) => r.data)
      .catch(() => null),

  /** Toggle on-duty availability (PATCH /api/v1/partners/{id}/availability) */
  setAvailability: (partnerId: string, isAvailable: boolean) =>
    apiClient
      .patch<{ id: string; is_available: boolean }>(
        `/partners/${partnerId}/availability`,
        { is_available: isAvailable }
      )
      .then((r) => r.data),

  /** Report GPS beacon location to Redis GEO (POST /api/v1/partners/{id}/location) */
  reportLocation: (partnerId: string, lat: number, lng: number) =>
    apiClient
      .post<{ id: string; lat: number; lng: number }>(
        `/partners/${partnerId}/location`,
        { lat, lng }
      )
      .then((r) => r.data),
};
