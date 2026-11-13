import { apiClient, createIdempotencyKey } from './api';
import {
  Job,
  CreateJobPayload,
  JobStatus,
  Service,
  ServiceCategory,
  JobRatingsResponse,
  ServiceCatalogResponse,
  JobHistoryPage,
  JobHistoryItem,
  JobCancelResponse,
  JobStatusTransitionResponse,
  PartnerLiveLocation,
  PublicJobTracking,
  SearchStatus,
} from '../types/jobs';

/**
 * Seeded service catalogue matching backend `db/seed.sql` exactly.
 * Prices are omitted per Backend Gap #7 & Amendment 1: backend holds no pricing data for services.
 */
export const SEEDED_SERVICES: Service[] = [
  {
    id: 1,
    category_id: 1,
    code: 'flatbed_towing',
    name: 'Flatbed Towing',
    requires_vehicle_equipment: true,
  },
  {
    id: 2,
    category_id: 1,
    code: 'wheel_lift_towing',
    name: 'Wheel-Lift Towing',
    requires_vehicle_equipment: true,
  },
  {
    id: 3,
    category_id: 2,
    code: 'battery_jumpstart',
    name: 'Battery Jumpstart',
    requires_vehicle_equipment: false,
  },
  {
    id: 4,
    category_id: 2,
    code: 'flat_tyre',
    name: 'Flat Tyre Support',
    requires_vehicle_equipment: false,
  },
  {
    id: 5,
    category_id: 2,
    code: 'minor_repair',
    name: 'On-Site Minor Repair',
    requires_vehicle_equipment: false,
  },
  {
    id: 6,
    category_id: 3,
    code: 'fuel_delivery',
    name: 'Emergency Fuel Delivery',
    requires_vehicle_equipment: false,
  },
];

export const SEEDED_SERVICE_CATEGORIES: ServiceCategory[] = [
  { id: 1, code: 'towing', name: 'Towing' },
  { id: 2, code: 'mechanical', name: 'Mechanical' },
  { id: 3, code: 'fuel', name: 'Fuel' },
];

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

  /**
   * The caller's own job history from GET /api/v1/jobs.
   */
  async listJobs(options?: { limit?: number; offset?: number }): Promise<JobHistoryItem[]> {
    const page = await this.listMyJobs(options);
    return page.items;
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

  /**
   * Contract fix: POST /jobs/{id}/cancel accepts { cancellation_reason?: string }
   * and forbids extra fields. Returns JobCancelResponse.
   */
  async cancelJob(jobId: string, cancellation_reason?: string): Promise<JobCancelResponse> {
    const res = await apiClient<JobCancelResponse>(`/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        ...(cancellation_reason ? { cancellation_reason } : {}),
      }),
    });
    return res.data;
  },

  /**
   * Advances a job along the dispatch lifecycle
   * (assigned → partner_en_route → in_progress → completed).
   *
   * Rejects with a 409 when the job has already moved on — two taps on
   * "Mark en route", or a job cancelled by the owner mid-transition.
   * Returns JobStatusTransitionResponse per backend schema.
   */
  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    extra?: { price_final?: number; cancellation_reason?: string }
  ): Promise<JobStatusTransitionResponse> {
    const res = await apiClient<JobStatusTransitionResponse>(`/jobs/${jobId}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        ...(extra?.price_final !== undefined ? { price_final: extra.price_final } : {}),
        ...(extra?.cancellation_reason ? { cancellation_reason: extra.cancellation_reason } : {}),
      }),
    });
    return res.data;
  },

  /**
   * Partner verifies the owner's 4-digit start code; the only route from
   * partner_en_route to in_progress. 400 INVALID_START_CODE on a wrong code.
   */
  async startJob(jobId: string, startCode: string): Promise<JobStatusTransitionResponse> {
    const res = await apiClient<JobStatusTransitionResponse>(`/jobs/${jobId}/start`, {
      method: 'POST',
      body: JSON.stringify({ start_code: startCode }),
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

  /**
   * The raw service catalog response from GET /api/v1/services.
   */
  async getServiceCatalog(): Promise<ServiceCatalogResponse> {
    const res = await apiClient<ServiceCatalogResponse>('/services', { method: 'GET' });
    return res.data;
  },

  /**
   * The service catalogue, from the database rather than from this file.
   *
   * `GET /api/v1/services` is unauthenticated, so this works on the landing page
   * and while sign-in is still resolving. `SEEDED_SERVICES` stays as a *fallback*.
   * Prices are omitted per Backend Gap #7 & Amendment 1.
   */
  async listServices(): Promise<Service[]> {
    try {
      const res = await apiClient<ServiceCatalogResponse>('/services', { method: 'GET' });
      return res.data.items.map((item) => ({
        id: item.id,
        category_id: item.category_id ?? 0,
        code: item.code,
        name: item.name,
        requires_vehicle_equipment: item.requires_vehicle_equipment,
        base_price: item.base_price,
        category:
          item.category_code && item.category_id
            ? { id: item.category_id, code: item.category_code, name: item.category_name ?? '' }
            : undefined,
      }));
    } catch {
      // Offline, or the backend is down. The grid still renders.
      return SEEDED_SERVICES;
    }
  },

  /**
   * Real-time GPS location of the partner assigned to an active job.
   */
  async getPartnerLocation(jobId: string): Promise<PartnerLiveLocation> {
    const res = await apiClient<PartnerLiveLocation>(`/jobs/${jobId}/partner-location`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Widen the search for a no_match_found job (ADR-023): 10 km, then 20 km
   * after 2 min, 35 km after 5; the window closes at 10 min. Max 12/min per job.
   */
  async retrySearch(jobId: string): Promise<SearchStatus> {
    const res = await apiClient<SearchStatus>(`/jobs/${jobId}/retry-search`, { method: 'POST' });
    return res.data;
  },

  /**
   * Sanitized public trip tracking for family and friends. Does not require sign-in.
   */
  async getPublicTracking(jobId: string, token: string): Promise<PublicJobTracking> {
    const res = await apiClient<PublicJobTracking>(
      `/jobs/${jobId}/public-tracking?t=${encodeURIComponent(token)}`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Categories, derived from the same call rather than fetched separately.
   *
   * There is no `GET /service-categories`: a category only ever appears attached
   * to a service, so a second endpoint would be a second thing to keep in step
   * with the first.
   */
  async listServiceCategories(): Promise<ServiceCategory[]> {
    try {
      const services = await this.listServices();
      const byId = new Map<number, ServiceCategory>();
      for (const service of services) {
        if (service.category) byId.set(service.category.id, service.category);
      }
      return byId.size > 0 ? [...byId.values()] : SEEDED_SERVICE_CATEGORIES;
    } catch {
      return SEEDED_SERVICE_CATEGORIES;
    }
  },

  /**
   * The caller's own job history, newest first — owner or partner, decided by the
   * token. There is deliberately no `role` parameter: the backend reads the role
   * from the token and would have to either ignore such a parameter or let a
   * caller choose whose jobs to list.
   */
  async listMyJobs(options: { limit?: number; offset?: number } = {}): Promise<JobHistoryPage> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiClient<JobHistoryPage>(`/jobs${query}`, { method: 'GET' });
    return res.data;
  },
};
