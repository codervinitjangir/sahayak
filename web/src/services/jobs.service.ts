import { apiClient, createIdempotencyKey } from './api';
import {
  Job,
  CreateJobPayload,
  JobStatus,
  Service,
  ServiceCategory,
  JobRatingsResponse,
} from '../types/jobs';

/**
 * Seeded service catalogue matching backend `db/seed.sql` exactly.
 * The backend does not have a dynamic `GET /services` endpoint (FRONTEND-GUIDE §2.3, §5.1, §5.4).
 */
export const SEEDED_SERVICES: Service[] = [
  {
    id: 1,
    category_id: 1,
    code: 'flatbed_towing',
    name: 'Flatbed Towing',
    requires_vehicle_equipment: true,
    estimated_price: 1500,
  },
  {
    id: 2,
    category_id: 1,
    code: 'wheel_lift_towing',
    name: 'Wheel-Lift Towing',
    requires_vehicle_equipment: true,
    estimated_price: 1200,
  },
  {
    id: 3,
    category_id: 2,
    code: 'battery_jumpstart',
    name: 'Battery Jumpstart',
    requires_vehicle_equipment: false,
    estimated_price: 450,
  },
  {
    id: 4,
    category_id: 2,
    code: 'flat_tyre',
    name: 'Flat Tyre Support',
    requires_vehicle_equipment: false,
    estimated_price: 350,
  },
  {
    id: 5,
    category_id: 2,
    code: 'minor_repair',
    name: 'On-Site Minor Repair',
    requires_vehicle_equipment: false,
    estimated_price: 500,
  },
  {
    id: 6,
    category_id: 3,
    code: 'fuel_delivery',
    name: 'Emergency Fuel Delivery',
    requires_vehicle_equipment: false,
    estimated_price: 300,
  },
];

export const SEEDED_SERVICE_CATEGORIES: ServiceCategory[] = [
  { id: 1, code: 'towing', name: 'Towing' },
  { id: 2, code: 'mechanical', name: 'Mechanical' },
  { id: 3, code: 'fuel', name: 'Fuel' },
];

const RECENT_JOBS_STORAGE_KEY = 'sahayak_recent_jobs';

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

    // Store in recent jobs list for OwnerHome display (since backend has no GET /jobs list endpoint)
    try {
      const raw = localStorage.getItem(RECENT_JOBS_STORAGE_KEY);
      const existing: Job[] = raw ? JSON.parse(raw) : [];
      const updated = [res.data, ...existing.filter((j) => j.id !== res.data.id)].slice(0, 10);
      localStorage.setItem(RECENT_JOBS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage quota errors
    }

    return res.data;
  },

  /**
   * Note: The backend does not expose a `GET /jobs` list endpoint (FRONTEND-GUIDE §5.1, §5.4).
   * We read recent jobs submitted on this device to provide continuity without throwing 404s.
   */
  async listJobs(): Promise<Job[]> {
    try {
      const raw = localStorage.getItem(RECENT_JOBS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
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

  /**
   * Reads ratings and whether the caller may rate this completed job.
   * Real endpoint: GET /api/v1/jobs/{job_id}/ratings (FRONTEND-GUIDE §2.6)
   */
  async getJobRatings(jobId: string): Promise<JobRatingsResponse> {
    const res = await apiClient<JobRatingsResponse>(`/jobs/${jobId}/ratings`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Rates a completed job (1-5 stars).
   * Real endpoint: POST /api/v1/jobs/{job_id}/ratings (FRONTEND-GUIDE §2.6, ADR-018)
   * 409 RATING_ALREADY_SUBMITTED is treated as success.
   */
  async submitRating(jobId: string, rating: number, comment?: string): Promise<void> {
    try {
      await apiClient<void>(`/jobs/${jobId}/ratings`, {
        method: 'POST',
        body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
      });
    } catch (err: unknown) {
      const errorObj = err as { code?: string; status?: number };
      if (errorObj?.code === 'RATING_ALREADY_SUBMITTED' || errorObj?.status === 409) {
        return; // Idempotently succeed per ADR-018
      }
      throw err;
    }
  },

  async listServices(): Promise<Service[]> {
    return Promise.resolve(SEEDED_SERVICES);
  },

  async listServiceCategories(): Promise<ServiceCategory[]> {
    return Promise.resolve(SEEDED_SERVICE_CATEGORIES);
  },
};
