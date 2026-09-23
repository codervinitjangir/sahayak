import { apiClient } from './api';
import { jobsService } from './jobs.service';
import * as mock from './partner.mock';
import { IS_DEMO_MODE } from '../app/config';
import type { Job, JobStatus } from '../types/jobs';
import type { EarningsWindow, PartnerEarnings, PartnerOffer, PartnerTrustStats } from '../types/partner';

/**
 * Partner dispatch API.
 *
 * The /partners/me/* endpoints are not built yet, so every call has two
 * branches: the real request, written out and ready, and the in-memory fixture
 * in ./partner.mock. VITE_PARTNER_API_MOCK picks between them — see
 * .env.example. No page or hook knows which branch ran.
 */

const MOCK_FLAG = import.meta.env.VITE_PARTNER_API_MOCK;

/** Unset means "mock in dev, real in a production build" — same rule as IS_DEMO_MODE. */
export const IS_PARTNER_API_MOCK = MOCK_FLAG === undefined ? IS_DEMO_MODE : MOCK_FLAG === 'true';

/** Enough latency for loading states to be real, none of it in the test run. */
const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 150;

function settle<T>(value: T): Promise<T> {
  if (MOCK_LATENCY_MS === 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

/** Mock errors must reject, not throw synchronously, to match the real client. */
function settleWith<T>(produce: () => T): Promise<T> {
  try {
    return settle(produce());
  } catch (error) {
    return Promise.reject(error);
  }
}

export const partnerService = {
  async getPendingOffer(): Promise<PartnerOffer | null> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getPendingOffer());

    const res = await apiClient<PartnerOffer | null>('/partners/me/offers/current', { method: 'GET' });
    return res.data;
  },

  /** Rejects with ApiError status 409 when another partner already took it. */
  async acceptOffer(offerId: string): Promise<Job> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.acceptOffer(offerId));

    const res = await apiClient<Job>(`/partners/me/offers/${offerId}/accept`, { method: 'POST' });
    return res.data;
  },

  async rejectOffer(offerId: string, reason?: string): Promise<void> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.rejectOffer(offerId));

    await apiClient<void>(`/partners/me/offers/${offerId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getActiveJob(): Promise<Job | null> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getActiveJob());

    const res = await apiClient<Job | null>('/partners/me/jobs/active', { method: 'GET' });
    return res.data;
  },

  async getJob(jobId: string): Promise<Job | null> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getJob(jobId));

    return jobsService.getJob(jobId);
  },

  /**
   * Advances the job. Delegates to jobsService so there is exactly one place
   * that knows the endpoint shape once the mock is switched off.
   */
  async updateJobStatus(jobId: string, status: JobStatus): Promise<Job> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.updateJobStatus(jobId, status));

    return jobsService.updateJobStatus(jobId, status);
  },

  async setAvailability(isAvailable: boolean): Promise<void> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.setAvailability(isAvailable));

    await apiClient<void>('/partners/me/availability', {
      method: 'POST',
      body: JSON.stringify({ is_available: isAvailable }),
    });
  },

  async getEarnings(window: EarningsWindow): Promise<PartnerEarnings> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getEarnings(window));

    const res = await apiClient<PartnerEarnings>(`/partners/me/earnings?window=${window}`, { method: 'GET' });
    return res.data;
  },

  async getTrustStats(): Promise<PartnerTrustStats> {
    if (IS_PARTNER_API_MOCK) return settleWith(() => mock.getTrustStats());

    const res = await apiClient<PartnerTrustStats>('/partners/me/stats', { method: 'GET' });
    return res.data;
  },

  /**
   * Demo affordance only — there is no way to make the real dispatcher send an
   * offer on request. The dashboard hides the control when not mocking.
   */
  async simulateIncomingOffer(): Promise<PartnerOffer | null> {
    if (!IS_PARTNER_API_MOCK) return null;
    return settleWith(() => mock.issueOffer());
  },
};
