import { apiClient } from "./client";

export type DisputeReason = "overcharged" | "service_not_done" | "partner_behaviour" | "damage" | "other";
export type DisputeStatus = "open" | "resolved" | "rejected" | "refunded";

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
  { value: "overcharged", label: "I was overcharged" },
  { value: "service_not_done", label: "The job was not done" },
  { value: "partner_behaviour", label: "Partner behaviour" },
  { value: "damage", label: "Damage to my vehicle" },
  { value: "other", label: "Something else" },
];

export const disputesApi = {
  /** Owner only. 409 JOB_NOT_DISPUTABLE before completion, 409 DISPUTE_ALREADY_OPEN for a second open report. */
  open: (jobId: string, reason: DisputeReason, description?: string) =>
    apiClient.post<Dispute>(`/jobs/${jobId}/disputes`, { reason, description: description || undefined }).then((r) => r.data),

  list: (jobId: string) => apiClient.get<Dispute[]>(`/jobs/${jobId}/disputes`).then((r) => r.data),
};
