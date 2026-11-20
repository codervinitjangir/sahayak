import { apiClient } from "./client";

// ADR-039 to ADR-042. GET /jobs/{id}/safeguards is polled beside GET /jobs/{id}.

export type RevisionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface PriceRevision {
  id: string;
  proposed_amount: number | string;
  reason: string;
  status: RevisionStatus;
  created_at: string;
  decided_at?: string | null;
}

export interface JobPhoto {
  id: string;
  stage: "pickup" | "drop";
  uploaded_at?: string | null;
}

export interface JobSafeguards {
  job_id: string;
  status: string;
  price_estimate?: number | string | null;
  /** Highest final price the partner may enter without asking. Null: any price needs approval. */
  price_allowed_max?: number | string | null;
  price_ceiling: number | string;
  pending_revision?: PriceRevision | null;
  revisions: PriceRevision[];
  photos_required: boolean;
  photos: JobPhoto[];
  new_partner_available_at?: string | null;
  can_request_new_partner: boolean;
}

export interface PhotoUploadTicket {
  photo_id: string;
  upload_url: string;
  max_bytes: number;
}

export const safeguardsApi = {
  get: (jobId: string) => apiClient.get<JobSafeguards>(`/jobs/${jobId}/safeguards`).then((r) => r.data),

  /** Partner. 400 PRICE_REVISION_NOT_NEEDED / PRICE_FINAL_OUT_OF_RANGE, 409 PRICE_REVISION_PENDING. */
  proposePrice: (jobId: string, amount: number, reason: string) =>
    apiClient.post<PriceRevision>(`/jobs/${jobId}/price-revisions`, { amount, reason }).then((r) => r.data),

  /** Owner. 409 PRICE_REVISION_CLOSED if already answered. */
  decidePrice: (jobId: string, revisionId: string, approve: boolean) =>
    apiClient
      .post<PriceRevision>(`/jobs/${jobId}/price-revisions/${revisionId}/decision`, { approve })
      .then((r) => r.data),

  /** Owner. 409 PARTNER_NOT_OVERDUE before new_partner_available_at. */
  requestNewPartner: (jobId: string) =>
    apiClient.post<JobSafeguards>(`/jobs/${jobId}/request-new-partner`, {}).then((r) => r.data),

  startPhoto: (jobId: string, stage: "pickup" | "drop", contentType: "image/jpeg" | "image/png" | "image/webp") =>
    apiClient
      .post<PhotoUploadTicket>(`/jobs/${jobId}/photos`, { stage, content_type: contentType })
      .then((r) => r.data),

  confirmPhoto: (jobId: string, photoId: string) =>
    apiClient.post<JobPhoto>(`/jobs/${jobId}/photos/${photoId}/confirm`, {}).then((r) => r.data),

  photoUrl: (jobId: string, photoId: string) =>
    apiClient.get<{ url: string; expires_in: number }>(`/jobs/${jobId}/photos/${photoId}/url`).then((r) => r.data),
};

/** Rupees for display; the API sends decimals as strings. */
export const amountOf = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Minutes until the owner may ask for another partner, or 0 if now. Null if not applicable. */
export function minutesUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}
