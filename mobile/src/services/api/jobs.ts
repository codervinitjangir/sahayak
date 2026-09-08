import { apiClient } from "./client";
import type { Job } from "../../types";

// ─── Job API calls ────────────────────────────────────────────────────────────

export const jobsApi = {
  /** Create a new roadside assistance job */
  createJob: (payload: Omit<Job, "id" | "created_at" | "updated_at">) =>
    apiClient.post<Job>("/jobs", payload).then((r) => r.data),

  /** Get job by ID */
  getJob: (jobId: string) =>
    apiClient.get<Job>(`/jobs/${jobId}`).then((r) => r.data),

  /** List owner's job history */
  listMyJobs: () =>
    apiClient.get<Job[]>("/jobs/me").then((r) => r.data),

  /** Cancel a pending job */
  cancelJob: (jobId: string) =>
    apiClient.patch<Job>(`/jobs/${jobId}/cancel`).then((r) => r.data),

  /** Partner: accept an assigned job */
  acceptJob: (jobId: string) =>
    apiClient.patch<Job>(`/jobs/${jobId}/accept`).then((r) => r.data),

  /** Partner: complete a job */
  completeJob: (jobId: string) =>
    apiClient.patch<Job>(`/jobs/${jobId}/complete`).then((r) => r.data),
};
