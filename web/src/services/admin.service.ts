import { apiClient } from './api';
import {
  AnalyticsDispatch,
  AnalyticsMatching,
  AnalyticsOverview,
  AnalyticsWindowParams,
} from '../types/admin';

/**
 * The three admin analytics reads.
 *
 * All three take the same optional half-open window and are admin-only: the
 * backend answers `403 FORBIDDEN` for an owner or a partner token and
 * `403 USER_NOT_REGISTERED` for an account with no profile at all. There is no
 * endpoint that makes someone an admin and there is not going to be one — an
 * `admins` row is a privilege grant, written by hand in SQL (ADR-020).
 *
 * The query parameters are `from` and `to`, not `from_ts`/`to_ts`: the route
 * aliases them, because `from` is a reserved word in Python and the handler's
 * parameter cannot be called that.
 */
function windowQuery(params: AnalyticsWindowParams): string {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export type PartnerVerificationStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

/** Mirrors backend AdminPartnerSummary (app/schemas/admin.py). */
export interface AdminPartnerSummary {
  id: string;
  phone: string;
  name: string | null;
  verification_status: PartnerVerificationStatus;
  /** Why the partner was rejected/suspended; null otherwise. */
  verification_note: string | null;
  is_available: boolean;
  rating_avg: string | number | null;
  rating_count: number | null;
  created_at: string;
}

export interface AdminPartnerListResponse {
  items: AdminPartnerSummary[];
  total: number;
}

export interface AdminPartnerDocument {
  id: string;
  doc_type: string | null;
  status: string;
  /** True when a file is stored; the storage path itself is never sent. */
  has_file: boolean;
  rejection_reason: string | null;
  expiry_date: string | null;
  uploaded_at: string;
}

export interface AdminPartnerEquipment {
  id: string;
  equipment_type: string | null;
  registration_number: string | null;
  verification_status: string;
}

export interface AdminPartnerDetail extends AdminPartnerSummary {
  documents: AdminPartnerDocument[];
  equipment: AdminPartnerEquipment[];
}

export const adminService = {
  /** Funnel, conversion, partner supply, time-to-work-started. */
  async getOverview(params: AnalyticsWindowParams = {}): Promise<AnalyticsOverview> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsOverview>(`/admin/analytics/overview${query}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** Offer outcomes, acceptance rates, no-match breakdown, dispatch latency. */
  async getDispatch(params: AnalyticsWindowParams = {}): Promise<AnalyticsDispatch> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsDispatch>(`/admin/analytics/dispatch${query}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** The weighted engine against pure-nearest, and which component drove it. */
  async getMatching(params: AnalyticsWindowParams = {}): Promise<AnalyticsMatching> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsMatching>(`/admin/analytics/matching${query}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** List partners with optional verification status filter */
  async listPartners(status?: string): Promise<AdminPartnerListResponse> {
    const q = status ? `?status=${status}` : '';
    const res = await apiClient<AdminPartnerListResponse>(`/admin/partners${q}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** One partner with documents and equipment, for the review dialog. */
  async getPartner(partnerId: string): Promise<AdminPartnerDetail> {
    const res = await apiClient<AdminPartnerDetail>(`/admin/partners/${partnerId}`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Update verification status. `notes` is required by the backend (422) when the
   * status is `rejected` or `suspended`, and ignored otherwise.
   */
  async verifyPartner(
    partnerId: string,
    verificationStatus: PartnerVerificationStatus,
    notes?: string,
  ): Promise<AdminPartnerSummary> {
    const res = await apiClient<AdminPartnerSummary>(`/admin/partners/${partnerId}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({
        verification_status: verificationStatus,
        ...(notes ? { notes } : {}),
      }),
    });
    return res.data;
  },
};
