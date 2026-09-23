import { apiClient, createIdempotencyKey } from './api';
import { Job, CreateJobPayload, JobStatus, Service, ServiceCategory } from '../types/jobs';

export const jobsService = {
  async createJob(payload: CreateJobPayload, idempotencyKey?: string): Promise<Job> {
    // Contract:
    // job create payload uses service_code, pickup_lat, pickup_lng
    // user_id is removed from body (auth token provides user identity)
    const body: Record<string, unknown> = {
      service_code: payload.service_code,
      pickup_lat: payload.pickup_lat,
      pickup_lng: payload.pickup_lng,
    };

    if (payload.vehicle_id) body.vehicle_id = payload.vehicle_id;
    if (payload.pickup_address_text) body.pickup_address_text = payload.pickup_address_text;
    if (typeof payload.drop_lat === 'number') body.drop_lat = payload.drop_lat;
    if (typeof payload.drop_lng === 'number') body.drop_lng = payload.drop_lng;
    if (payload.issue_description) body.issue_description = payload.issue_description;
    if (payload.issue_photo_urls && payload.issue_photo_urls.length > 0) {
      body.issue_photo_urls = payload.issue_photo_urls;
    }

    const res = await apiClient<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey: idempotencyKey || createIdempotencyKey(),
    });
    return res.data;
  },

  async listJobs(): Promise<Job[]> {
    const res = await apiClient<Job[]>('/jobs', {
      method: 'GET',
    });
    return res.data;
  },

  async getJob(jobId: string): Promise<Job> {
    const res = await apiClient<Job>(`/jobs/${jobId}`, {
      method: 'GET',
    });
    const job = res.data;
    if (job && !job.pickup_location && typeof job.pickup_lat === 'number') {
      job.pickup_location = {
        lat: job.pickup_lat,
        lng: job.pickup_lng ?? 0,
        address: job.pickup_address_text,
      };
    }
    return job;
  },

  async cancelJob(jobId: string, reason?: string): Promise<Job> {
    const res = await apiClient<Job>(`/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return res.data;
  },

  /**
   * Advances a job along the dispatch lifecycle
   * (assigned → partner_en_route → in_progress → completed).
   *
   * Rejects with a 409 when the job has already moved on — two taps on
   * "Mark en route", or a job cancelled by the owner mid-transition.
   */
  async updateJobStatus(jobId: string, status: JobStatus): Promise<Job> {
    const res = await apiClient<Job>(`/jobs/${jobId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    return res.data;
  },

  async submitRating(jobId: string, rating: number, comment?: string): Promise<void> {
    await apiClient<void>(`/jobs/${jobId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
  },

  async listServices(): Promise<Service[]> {
    const res = await apiClient<Service[]>('/services', {
      method: 'GET',
    });
    return res.data;
  },

  async listServiceCategories(): Promise<ServiceCategory[]> {
    const res = await apiClient<ServiceCategory[]>('/services/categories', {
      method: 'GET',
    });
    return res.data;
  },
};
