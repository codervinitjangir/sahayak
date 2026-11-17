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
  partner_en_route: { next: 'in_progress', label: 'Verify code & start job' },
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
  isResponding: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Accept / reject in one place.
 * Offers expire: dispatch times one out 60 s after it was made (ADR-032), and a
 * late answer then gets 409, which reads as OFFER_GONE_MESSAGE here.
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
    mutationFn: async (offerId: string) => {
      const res = await partnerService.acceptOffer(offerId);
      return partnerService.getJob(res.job_id);
    },
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
    isResponding: acceptMutation.isPending || rejectMutation.isPending,
    error,
    clearError: () => setError(null),
  };
}

export function useJobStatusTransition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      status,
      priceFinal,
      startCode,
    }: {
      jobId: string;
      status: JobStatus;
      /** Required by the backend on a completion (400 PRICE_FINAL_REQUIRED otherwise). */
      priceFinal?: number;
      /** in_progress is reached only through POST /jobs/{id}/start with the owner's code. */
      startCode?: string;
    }) =>
      status === 'in_progress'
        ? partnerService.startJob(jobId, startCode ?? '')
        : partnerService.updateJobStatus(
            jobId,
            status,
            status === 'completed' ? { price_final: priceFinal } : undefined
          ),
    onSuccess: (transition) => {
      // A completed job is no longer the active one.
      queryClient.setQueryData(
        PARTNER_ACTIVE_JOB_KEY,
        transition.status === 'completed' ? null : undefined
      );
      queryClient.invalidateQueries({ queryKey: PARTNER_ACTIVE_JOB_KEY });
      queryClient.invalidateQueries({ queryKey: PARTNER_EARNINGS_KEY });
      queryClient.invalidateQueries({ queryKey: PARTNER_STATS_KEY });
    },
  });
}

export const PARTNER_SERVICES_KEY = ['partner', 'services'];

/** The services the backend has linked to this partner. */
export function usePartnerServices() {
  return useQuery({
    queryKey: PARTNER_SERVICES_KEY,
    queryFn: () => partnerService.getMyServices(),
    staleTime: 30_000,
  });
}
