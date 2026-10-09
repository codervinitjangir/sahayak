import { apiClient } from './api';
import {
  AnalyticsDispatch,
  AnalyticsMatching,
  AnalyticsOverview,
  AnalyticsWindowParams,
} from '../types/admin';

/**
 * The three admin analytics reads.
 *
 * All three take the same optional half-open window and are admin-only: the
 * backend answers `403 FORBIDDEN` for an owner or a partner token and
 * `403 USER_NOT_REGISTERED` for an account with no profile at all. There is no
 * endpoint that makes someone an admin and there is not going to be one — an
 * `admins` row is a privilege grant, written by hand in SQL (ADR-020).
 *
 * The query parameters are `from` and `to`, not `from_ts`/`to_ts`: the route
 * aliases them, because `from` is a reserved word in Python and the handler's
 * parameter cannot be called that.
 */
function windowQuery(params: AnalyticsWindowParams): string {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const adminService = {
  /** Funnel, conversion, partner supply, time-to-work-started. */
  async getOverview(params: AnalyticsWindowParams = {}): Promise<AnalyticsOverview> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsOverview>(`/admin/analytics/overview${query}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** Offer outcomes, acceptance rates, no-match breakdown, dispatch latency. */
  async getDispatch(params: AnalyticsWindowParams = {}): Promise<AnalyticsDispatch> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsDispatch>(`/admin/analytics/dispatch${query}`, {
      method: 'GET',
    });
    return res.data;
  },

  /** The weighted engine against pure-nearest, and which component drove it. */
  async getMatching(params: AnalyticsWindowParams = {}): Promise<AnalyticsMatching> {
    const query = windowQuery(params);
    const res = await apiClient<AnalyticsMatching>(`/admin/analytics/matching${query}`, {
      method: 'GET',
    });
    return res.data;
  },
};
