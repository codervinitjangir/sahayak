import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../services/api';
import { partnerService } from '../../services/partner.service';
import type { Job, JobStatus } from '../../types/jobs';
import type { EarningsWindow } from '../../types/partner';

export const PARTNER_OFFER_KEY = ['partner', 'offer'];
export const PARTNER_ACTIVE_JOB_KEY = ['partner', 'active-job'];
export const PARTNER_EARNINGS_KEY = ['partner', 'earnings'];
export const PARTNER_STATS_KEY = ['partner', 'stats'];

/**
 * The exact copy for a lost race. A partner who taps Accept a half-second late
 * has not hit an error — someone else simply got there first, and saying
 * "Something went wrong" would imply their app is broken.
 */
export const OFFER_GONE_MESSAGE = 'This offer is no longer available';

function offerErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 409 ? OFFER_GONE_MESSAGE : error.message;
  }
  return 'Could not reach dispatch. Check your connection and try again.';
}

/** The one transition the primary button may make, per current status. */
export const NEXT_TRANSITION: Partial<Record<JobStatus, { next: JobStatus; label: string }>> = {
  assigned: { next: 'partner_en_route', label: 'Mark en route' },
  partner_en_route: { next: 'in_progress', label: 'Mark arrived / start job' },
  in_progress: { next: 'completed', label: 'Mark complete' },
};

export function useActiveJob() {
  return useQuery({
    queryKey: PARTNER_ACTIVE_JOB_KEY,
    queryFn: () => partnerService.getActiveJob(),
    refetchInterval: (query) => (query.state.data ? 7000 : false),
  });
}

/**
 * The offer dispatch is holding, if any.
 *
 * Disabled off duty and while a job is running — a partner mid-repair is not
 * being offered anything, so polling for one would only invite a stale accept.
 */
export function usePendingOffer(enabled: boolean) {
  return useQuery({
    queryKey: PARTNER_OFFER_KEY,
    queryFn: () => partnerService.getPendingOffer(),
    enabled,
    refetchInterval: enabled ? 4000 : false,
  });
}

export function usePartnerEarnings(window: EarningsWindow) {
  return useQuery({
    queryKey: [...PARTNER_EARNINGS_KEY, window],
    queryFn: () => partnerService.getEarnings(window),
  });
}

export function usePartnerTrustStats() {
  return useQuery({
    queryKey: PARTNER_STATS_KEY,
    queryFn: () => partnerService.getTrustStats(),
  });
}

export interface OfferResponse {
  /** Resolves to the accepted job, or null when the offer was already gone. */
  accept: (offerId: string) => Promise<Job | null>;
  reject: (offerId: string) => Promise<void>;
  /** Timer hit zero. Releases the offer without showing the partner an error. */
  expire: (offerId: string) => void;
  isResponding: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Accept / reject / timeout, in one place.
 *
 * The dashboard's inline offer card and the full OffersPage both call this, so
 * the two can never drift on what a 409 means or on what happens at 0s.
 */
export function useOfferResponse(): OfferResponse {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const refreshDispatch = () => {
    queryClient.invalidateQueries({ queryKey: PARTNER_OFFER_KEY });
    queryClient.invalidateQueries({ queryKey: PARTNER_ACTIVE_JOB_KEY });
    queryClient.invalidateQueries({ queryKey: PARTNER_STATS_KEY });
  };

  const acceptMutation = useMutation({
    mutationFn: (offerId: string) => partnerService.acceptOffer(offerId),
    onSuccess: (job) => {
      setError(null);
      queryClient.setQueryData(PARTNER_ACTIVE_JOB_KEY, job);
      queryClient.setQueryData(PARTNER_OFFER_KEY, null);
      refreshDispatch();
    },
    onError: (err) => {
      setError(offerErrorMessage(err));
      // Whatever went wrong, this offer is not ours — take it off the board so
      // the partner cannot keep tapping a dead Accept button.
      queryClient.setQueryData(PARTNER_OFFER_KEY, null);
      refreshDispatch();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (offerId: string) => partnerService.rejectOffer(offerId),
    onSettled: () => {
      queryClient.setQueryData(PARTNER_OFFER_KEY, null);
      refreshDispatch();
    },
  });

  return {
    accept: async (offerId) => {
      try {
        return await acceptMutation.mutateAsync(offerId);
      } catch {
        return null; // onError has already set the message.
      }
    },
    reject: async (offerId) => {
      setError(null);
      try {
        await rejectMutation.mutateAsync(offerId);
      } catch {
        // Declining something that already vanished is still declined.
      }
    },
    expire: (offerId) => {
      setError(null);
      queryClient.setQueryData(PARTNER_OFFER_KEY, null);
      void partnerService.rejectOffer(offerId, 'timed_out').catch(() => undefined);
      refreshDispatch();
    },
    isResponding: acceptMutation.isPending || rejectMutation.isPending,
    error,
    clearError: () => setError(null),
  };
}

export function useJobStatusTransition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobStatus }) =>
      partnerService.updateJobStatus(jobId, status),
    onSuccess: (job) => {
      // A completed job is no longer the active one.
      queryClient.setQueryData(PARTNER_ACTIVE_JOB_KEY, job.status === 'completed' ? null : job);
      queryClient.invalidateQueries({ queryKey: PARTNER_ACTIVE_JOB_KEY });
      queryClient.invalidateQueries({ queryKey: PARTNER_EARNINGS_KEY });
      queryClient.invalidateQueries({ queryKey: PARTNER_STATS_KEY });
    },
  });
}
