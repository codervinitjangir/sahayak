import { apiClient } from "./client";
import type { Job } from "../../types";

// ─── Job API calls ────────────────────────────────────────────────────────────

export const jobsApi = {
  /** Create a new roadside assistance job */
  createJob: (payload: Omit<Job, "id" | "createdAt" | "updatedAt">, idempotencyKey?: string) =>
    apiClient.post<Job>("/jobs", payload, {
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }).then((r) => r.data),

  /** Get job by ID */
  getJob: (jobId: string) =>
    apiClient.get<Job>(`/jobs/${jobId}`).then((r) => r.data),

  /** List owner's job history */
  listMyJobs: () =>
    apiClient.get<Job[]>("/jobs/me").then((r) => r.data),

  /** Cancel a pending or active job */
  cancelJob: (jobId: string, reason?: string) =>
    apiClient.post<Job>(`/jobs/${jobId}/cancel`, { reason }).then((r) => r.data),

  /** Partner: respond to an offer assignment (accept or reject) */
  respondToAssignment: (assignmentId: string, action: "accept" | "reject", rejectionReason?: string) =>
    apiClient.post(`/job-assignments/${assignmentId}/respond`, {
      action,
      rejection_reason: rejectionReason,
    }).then((r) => r.data),

  /** Partner: update job status (partner_en_route, in_progress, completed) */
  updateJobStatus: (jobId: string, status: string, priceFinal?: number) =>
    apiClient.post<Job>(`/jobs/${jobId}/status`, {
      status,
      price_final: priceFinal,
    }).then((r) => r.data),
};
