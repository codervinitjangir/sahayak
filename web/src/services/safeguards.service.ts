import { apiClient } from './api';

// ADR-039 to ADR-042. GET /jobs/{id}/safeguards sits beside GET /jobs/{id}.

export type RevisionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface PriceRevision {
  id: string;
  proposed_amount: string | number;
  reason: string;
  status: RevisionStatus;
  created_at: string;
  decided_at?: string | null;
}

export interface JobSafeguards {
  job_id: string;
  status: string;
  price_estimate?: string | number | null;
  price_allowed_max?: string | number | null;
  price_ceiling: string | number;
  pending_revision?: PriceRevision | null;
  revisions: PriceRevision[];
  photos_required: boolean;
  photos: { id: string; stage: 'pickup' | 'drop'; uploaded_at?: string | null }[];
  new_partner_available_at?: string | null;
  can_request_new_partner: boolean;
}

export const safeguardsService = {
  async get(jobId: string): Promise<JobSafeguards> {
    return (await apiClient<JobSafeguards>(`/jobs/${jobId}/safeguards`, { method: 'GET' })).data;
  },
  async proposePrice(jobId: string, amount: number, reason: string): Promise<PriceRevision> {
    return (await apiClient<PriceRevision>(`/jobs/${jobId}/price-revisions`, {
      method: 'POST', body: JSON.stringify({ amount, reason }),
    })).data;
  },
  async decidePrice(jobId: string, revisionId: string, approve: boolean): Promise<PriceRevision> {
    return (await apiClient<PriceRevision>(`/jobs/${jobId}/price-revisions/${revisionId}/decision`, {
      method: 'POST', body: JSON.stringify({ approve }),
    })).data;
  },
  async requestNewPartner(jobId: string): Promise<JobSafeguards> {
    return (await apiClient<JobSafeguards>(`/jobs/${jobId}/request-new-partner`, { method: 'POST', body: '{}' })).data;
  },
  async photoUrl(jobId: string, photoId: string): Promise<string> {
    return (await apiClient<{ url: string; expires_in: number }>(`/jobs/${jobId}/photos/${photoId}/url`, { method: 'GET' })).data.url;
  },
};

export const amountOf = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

export const inr = (v: number | null): string => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);

export function minutesUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}
