import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jobsService } from '../../services/jobs.service';
import { CreateJobPayload } from '../../types/jobs';

export const JOBS_QUERY_KEY = ['jobs'];
export const SERVICES_QUERY_KEY = ['services'];

export function useJobs() {
  return useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: () => jobsService.listJobs(),
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => (jobId ? jobsService.getJob(jobId) : Promise.reject('No jobId provided')),
    enabled: Boolean(jobId),
    // Polling cadence per .agents/skills/dispatch-ui: fastest while we are actively
    // searching for a partner, slower once one is on the way, stopped once the job
    // has reached a terminal state.
    refetchInterval: (query) => {
      switch (query.state.data?.status) {
        case 'requested':
        case 'matching':
          return 4000;
        case 'assigned':
        case 'partner_en_route':
          return 7000;
        case 'in_progress':
          return 15000;
        default:
          // completed / cancelled / no_match_found — nothing further will change.
          return false;
      }
    },
  });
}

export function useServices() {
  return useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: () => jobsService.listServices(),
    staleTime: 1000 * 60 * 15, // 15 minutes (reference data)
  });
}

interface CreateJobMutationVariables {
  payload: CreateJobPayload;
  idempotencyKey?: string;
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CreateJobMutationVariables) =>
      jobsService.createJob(payload, idempotencyKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason?: string }) =>
      jobsService.cancelJob(jobId, reason),
    onSuccess: (_, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
    },
  });
}
