import { apiClient } from './api';
import { Job, CreateJobPayload, Service, ServiceCategory } from '../types/jobs';

export const jobsService = {
  async createJob(payload: CreateJobPayload, idempotencyKey?: string): Promise<Job> {
    const res = await apiClient<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
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
    return res.data;
  },

  async cancelJob(jobId: string, reason?: string): Promise<Job> {
    const res = await apiClient<Job>(`/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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
