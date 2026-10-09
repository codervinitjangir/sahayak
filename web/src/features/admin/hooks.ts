import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../services/api';
import { adminService } from '../../services/admin.service';
import { AnalyticsWindowParams } from '../../types/admin';

/**
 * The window presets.
 *
 * Half-open, matching the backend: `from` inclusive, `to` exclusive. `to` is
 * left unset for every preset — an open upper bound means "up to now" and avoids
 * a window that silently excludes the last few seconds, which is exactly the
 * range an operator watching a live dispatch cares about.
 */
export type WindowPreset = 'all' | '24h' | '7d' | '30d';

export const WINDOW_PRESETS: { id: WindowPreset; label: string }[] = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

const HOURS: Record<Exclude<WindowPreset, 'all'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/** Turn a preset into the query parameters the three endpoints accept. */
export function paramsFor(preset: WindowPreset): AnalyticsWindowParams {
  if (preset === 'all') return {};
  const from = new Date(Date.now() - HOURS[preset] * 3600_000);
  return { from: from.toISOString() };
}

/**
 * Shared query options.
 *
 * `placeholderData: keepPreviousData` holds the previous render while a new
 * window loads, so switching presets does not flash a skeleton and jump the
 * layout — the panels fade instead. `staleTime` is short because these are
 * operational figures someone may be watching during an incident, but not zero:
 * three endpoints refetching on every focus change would hammer a database whose
 * connection budget is fifteen.
 */
const SHARED = {
  staleTime: 30_000,
  /**
   * Never retry a 4xx.
   *
   * A 403 here means this account is not an admin, and admin access is granted
   * by hand in SQL (ADR-020) — so retrying delays a message that will never
   * change by a backoff interval, with the reader looking at a spinner. Server
   * errors and network failures are worth one retry; a refusal is not.
   */
  retry: (failureCount: number, error: unknown) => {
    const status = error instanceof ApiError ? error.status : undefined;
    if (status !== undefined && status >= 400 && status < 500) return false;
    return failureCount < 1;
  },
  placeholderData: <T,>(previous: T | undefined) => previous,
} as const;

export function useOverview(preset: WindowPreset) {
  const params = paramsFor(preset);
  return useQuery({
    queryKey: ['admin', 'overview', preset],
    queryFn: () => adminService.getOverview(params),
    ...SHARED,
  });
}

export function useDispatch(preset: WindowPreset) {
  const params = paramsFor(preset);
  return useQuery({
    queryKey: ['admin', 'dispatch', preset],
    queryFn: () => adminService.getDispatch(params),
    ...SHARED,
  });
}

export function useMatching(preset: WindowPreset) {
  const params = paramsFor(preset);
  return useQuery({
    queryKey: ['admin', 'matching', preset],
    queryFn: () => adminService.getMatching(params),
    ...SHARED,
  });
}
