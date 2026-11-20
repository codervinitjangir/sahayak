import { apiClient } from './api';

/** Owner problem reports on a job (payments item E, ADR-043). Same vocabulary as the mobile app. */
export type DisputeReason =
  | 'overcharged'
  | 'service_not_done'
  | 'partner_behaviour'
  | 'damage'
  | 'off_app_payment'
  | 'other';
export type DisputeStatus = 'open' | 'resolved' | 'rejected' | 'refunded';

export interface Dispute {
  id: string;
  job_id: string;
  reason: DisputeReason;
  description?: string | null;
  status: DisputeStatus;
  resolution_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export const DISPUTE_REASONS: { value: DisputeReason; label: string }[] = [
  { value: 'overcharged', label: 'I was overcharged' },
  { value: 'service_not_done', label: 'The job was not done' },
  { value: 'partner_behaviour', label: 'Partner behaviour' },
  { value: 'damage', label: 'Damage to my vehicle' },
  { value: 'off_app_payment', label: 'Asked to pay outside the app' },
  { value: 'other', label: 'Something else' },
];

/** ADR-043: what a cancelled job (that a partner had accepted) may be reported for. */
export const CANCELLED_JOB_REASONS: DisputeReason[] = ['off_app_payment', 'partner_behaviour', 'damage', 'other'];

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Open: our team is looking at it',
  resolved: 'Resolved',
  rejected: 'Closed without action',
  refunded: 'Refund recorded',
};

export const disputesService = {
  /** 409 JOB_NOT_DISPUTABLE unless completed, or cancelled after a partner accepted; 409 DISPUTE_ALREADY_OPEN. */
  async open(jobId: string, reason: DisputeReason, description?: string): Promise<Dispute> {
    return (await apiClient<Dispute>(`/jobs/${jobId}/disputes`, {
      method: 'POST',
      body: JSON.stringify({ reason, description: description?.trim() || undefined }),
    })).data;
  },

  async list(jobId: string): Promise<Dispute[]> {
    return (await apiClient<Dispute[]>(`/jobs/${jobId}/disputes`, { method: 'GET' })).data;
  },
};
