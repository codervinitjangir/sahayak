import { apiClient } from './api';
import { JobRatingsResponse, RatingItem } from '../types/jobs';

export const ratingsService = {
  /**
   * Reads ratings and whether the caller may rate this completed job.
   * Real endpoint: GET /api/v1/jobs/{job_id}/ratings
   */
  async getJobRatings(jobId: string): Promise<JobRatingsResponse> {
    const res = await apiClient<JobRatingsResponse>(`/jobs/${jobId}/ratings`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Rates a completed job (1-5 stars).
   * Real endpoint: POST /api/v1/jobs/{job_id}/ratings
   * Returns RatingItem. 409 RATING_ALREADY_SUBMITTED is treated as idempotent per ADR-018.
   */
  async submitRating(jobId: string, rating: number, comment?: string): Promise<RatingItem | null> {
    try {
      const res = await apiClient<RatingItem>(`/jobs/${jobId}/ratings`, {
        method: 'POST',
        body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
      });
      return res.data;
    } catch (err: unknown) {
      const errorObj = err as { code?: string; status?: number };
      if (errorObj?.code === 'RATING_ALREADY_SUBMITTED' || errorObj?.status === 409) {
        return null;
      }
      throw err;
    }
  },
};
