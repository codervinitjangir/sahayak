import { apiClient } from "./client";
import type { BackendJob } from "./jobs";

export interface MobilePartnerTrustStats {
  partner_id: string;
  verification_status: string;
  /** Server duty state; the on/off switch is seeded from this. */
  is_available?: boolean;
  rating_avg: number;
  rating_count: number;
  acceptance_rate_pct: number;
  lifetime_jobs: number;
}

export interface MobilePartnerService {
  service_id: number;
  code: string;
  name: string;
  base_price: number | null;
  /** services.requires_vehicle_equipment (towing). */
  requires_equipment?: boolean;
  /** False when dispatch will not send this service to the partner (needs a
   *  verified tow vehicle they do not have). Absent on older backends = true. */
  dispatchable?: boolean;
}

export interface MobilePartnerServices {
  partner_id: string;
  services: MobilePartnerService[];
}

export interface MobilePartnerEarnings {
  partner_id: string;
  currency: string;
  today_amount: number;
  today_jobs: number;
  week_amount: number;
  week_jobs: number;
  lifetime_amount: number;
  lifetime_jobs: number;
}

export const partnerApi = {
  /** Edit the partner's display name (PATCH /partners/me, G8). */
  updateMe: (name: string) =>
    apiClient
      .patch<{ id: string; name: string; phone: string; verification_status: string }>("/partners/me", { name })
      .then((r) => r.data),

  /** Register a partner (POST /partners). Identity comes from the bearer, not this body. */
  register: (name: string, phone: string, primaryCategoryCode: string) =>
    apiClient
      .post<{ id: string }>("/partners", { name, phone, primary_category_code: primaryCategoryCode })
      .then((r) => r.data),

  /** Bind the new profile to the signed-in login (POST /partners/{id}/link-auth). */
  linkAuth: (partnerId: string) => apiClient.post(`/partners/${partnerId}/link-auth`).then((r) => r.data),

  /** Replace the services this partner offers (POST /partners/{id}/services). */
  setServices: (partnerId: string, serviceCodes: string[]) =>
    apiClient.post(`/partners/${partnerId}/services`, { service_codes: serviceCodes }).then((r) => r.data),

  /** Fetch partner performance and trust stats (GET /api/v1/partners/me/stats) */
  getStats: () =>
    apiClient
      .get<MobilePartnerTrustStats>("/partners/me/stats")
      .then((r) => r.data),

  /** Completed-job payouts for today, this week and lifetime (GET /partners/me/earnings) */
  getEarnings: () =>
    apiClient
      .get<MobilePartnerEarnings>("/partners/me/earnings")
      .then((r) => r.data),

  /** The services this partner is linked to, with backend base prices (GET /partners/me/services) */
  getServices: () =>
    apiClient
      .get<MobilePartnerServices>("/partners/me/services")
      .then((r) => r.data),

  /**
   * Fetch the accepted job this partner is currently on, or null when idle
   * (GET /api/v1/partners/me/jobs/active).
   *
   * A network failure is *not* mapped to null: callers must be able to tell
   * "you have no active job" from "we could not ask", or a mechanic with a job
   * on the road silently sees an empty dashboard.
   */
  getActiveJob: () =>
    apiClient
      .get<BackendJob | null>("/partners/me/jobs/active")
      .then((r) => r.data),

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
