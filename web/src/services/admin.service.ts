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

// ---- Back office (ADR-024) -------------------------------------------------

export interface AdminJobItem {
  id: string;
  status: string;
  service_name?: string | null;
  vehicle_number?: string | null;
  pickup_address_text?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  partner_name?: string | null;
  partner_phone?: string | null;
  assignment_status?: string | null;
  price_estimate?: string | number | null;
  price_final?: string | number | null;
  requested_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
}

export interface AdminUserItem {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  created_at: string;
  job_count: number;
  has_login: boolean;
  suspended_at?: string | null;
  suspension_reason?: string | null;
}

export interface AdminAuditEntry {
  id: string;
  admin_id?: string | null;
  action: string;
  target_type: 'job' | 'user' | 'partner' | 'dispute' | 'service' | 'admin';
  /** Null for a service: its code is in `details.service_code`. */
  target_id: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export type StaffRole = 'super_admin' | 'ops' | 'support' | 'finance';

export interface StaffMember {
  id: string;
  name?: string | null;
  role: StaffRole | string;
  phone?: string | null;
  has_login: boolean;
  disabled_at?: string | null;
  created_at?: string | null;
  is_you: boolean;
}

export interface StaffInvite {
  id: string;
  name: string;
  role: StaffRole | string;
  phone: string;
  created_at?: string | null;
  expires_at: string;
  expired: boolean;
}

export interface StaffList {
  staff: StaffMember[];
  invites: StaffInvite[];
  your_role: string;
}

export interface AdminCatalogueItem {
  id: number;
  code: string;
  name: string;
  base_price: string | number | null;
  category_name?: string | null;
}

export interface AdminAlert {
  code: 'STUCK_JOBS' | 'HIGH_NO_MATCH_RATE' | 'NO_PARTNERS_ON_DUTY' | 'LOW_PARTNERS_ON_DUTY' | string;
  severity: 'critical' | 'warning';
  message: string;
  count: number;
  job_ids: string[];
}

export interface AdminAlerts {
  generated_at: string;
  alerts: AdminAlert[];
  live_jobs: number;
  partners_on_duty: number;
  partners_verified: number;
  window_minutes: number;
  jobs_in_window: number;
  no_match_in_window: number;
  no_match_rate: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const str = q.toString();
  return str ? `?${str}` : '';
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

  /** Live jobs board. status: 'live' (default), 'all', or one job status. */
  async listJobs(params: { status?: string; q?: string; limit?: number; offset?: number } = {}): Promise<Page<AdminJobItem>> {
    const res = await apiClient<Page<AdminJobItem>>(`/admin/jobs${qs(params)}`, { method: 'GET' });
    return res.data;
  },

  /** Staff cancel; reason is required and goes in the audit log. */
  async cancelJob(jobId: string, reason: string): Promise<AdminJobItem> {
    const res = await apiClient<AdminJobItem>(`/admin/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return res.data;
  },

  /**
   * Takes the job from its partner and offers it to the next-best one. The
   * returned status is 'matching' (a new offer is out) or 'no_match_found'.
   */
  async reassignJob(jobId: string, reason: string): Promise<AdminJobItem> {
    const res = await apiClient<AdminJobItem>(`/admin/jobs/${jobId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return res.data;
  },

  async listUsers(params: { q?: string; limit?: number; offset?: number } = {}): Promise<Page<AdminUserItem>> {
    const res = await apiClient<Page<AdminUserItem>>(`/admin/users${qs(params)}`, { method: 'GET' });
    return res.data;
  },

  async setUserSuspension(userId: string, suspended: boolean, reason?: string): Promise<AdminUserItem> {
    const res = await apiClient<AdminUserItem>(`/admin/users/${userId}/suspension`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended, ...(reason ? { reason } : {}) }),
    });
    return res.data;
  },

  async listAudit(params: { target_type?: string; target_id?: string; limit?: number; offset?: number } = {}): Promise<Page<AdminAuditEntry>> {
    const res = await apiClient<Page<AdminAuditEntry>>(`/admin/audit-log${qs(params)}`, { method: 'GET' });
    return res.data;
  },

  async listStaff(): Promise<StaffList> {
    const res = await apiClient<StaffList>('/admin/staff', { method: 'GET' });
    return res.data;
  },

  /** The returned `token` is shown once; the server keeps only its hash. */
  async inviteStaff(body: { name: string; phone: string; role: StaffRole }): Promise<StaffInvite & { token: string }> {
    const res = await apiClient<StaffInvite & { token: string }>('/admin/invites', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.data;
  },

  async revokeInvite(inviteId: string): Promise<void> {
    await apiClient<{ revoked: boolean }>(`/admin/invites/${inviteId}`, { method: 'DELETE' });
  },

  async acceptInvite(token: string): Promise<StaffMember> {
    const res = await apiClient<StaffMember>('/admin/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return res.data;
  },

  async updateStaff(adminId: string, body: { role?: StaffRole; disabled?: boolean; reason: string }): Promise<StaffMember> {
    const res = await apiClient<StaffMember>(`/admin/staff/${adminId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return res.data;
  },

  /**
   * The catalogue straight from the server. Deliberately not jobsService.listServices():
   * that one falls back to a seeded list when the call fails, and a price editor
   * must never show prices the server did not send.
   */
  async listCatalogue(): Promise<AdminCatalogueItem[]> {
    const res = await apiClient<{ items: AdminCatalogueItem[] }>('/services', { method: 'GET' });
    return res.data.items;
  },

  /** Applies to requests made after the change; existing jobs keep their estimate. */
  async setServicePrice(code: string, basePrice: string, reason: string): Promise<AdminCatalogueItem> {
    const res = await apiClient<AdminCatalogueItem>(`/admin/services/${encodeURIComponent(code)}/price`, {
      method: 'PATCH',
      body: JSON.stringify({ base_price: basePrice, reason }),
    });
    return res.data;
  },

  /** Stuck jobs, no-match rate and partner cover, computed by the server on each read. */
  async getAlerts(): Promise<AdminAlerts> {
    const res = await apiClient<AdminAlerts>('/admin/alerts', { method: 'GET' });
    return res.data;
  },
};
